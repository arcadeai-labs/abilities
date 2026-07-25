/**
 * Runs a compiled script inside QuickJS-on-WASM.
 *
 * The security property this file provides is not "QuickJS is unescapable" — it is
 * that **the guest holds no capability it was not handed**. A fresh context starts
 * with ECMAScript builtins and nothing else: no `fetch`, no `require`, no
 * `process`, no timers, no I/O of any kind. Two host functions are installed, and
 * the tool bridge is generated from the script's stored grant, so a tool outside
 * the grant does not merely fail the allowlist check — it does not exist as a
 * property in the guest.
 *
 * Values cross the boundary as JSON strings only. No live object graphs, no
 * functions, no proxies — which is what keeps prototype-pollution and
 * reference-leak bugs out of the bridge.
 *
 * The `sync` variant is used deliberately over `asyncify`: an asyncified module can
 * only suspend for one host call at a time *across every context inside it*, which
 * would serialise concurrent runs. Deferred promises have no such limit.
 */

import RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { CONFIG_GLOBAL } from "./compile";

export type Limits = {
  memoryBytes: number;
  stackBytes: number;
  /** Wall clock for the whole run, host calls included. */
  timeoutMs: number;
  maxToolCalls: number;
  maxOutputBytes: number;
  maxLogs: number;
  maxLogBytes: number;
};

export const DEFAULT_LIMITS: Limits = {
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  timeoutMs: 15_000,
  maxToolCalls: 20,
  maxOutputBytes: 256 * 1024,
  maxLogs: 200,
  maxLogBytes: 32 * 1024,
};

export type ToolCallRecord = {
  path: string;
  qualifiedName: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

export type LimitName = "cpu" | "memory" | "tool_calls" | "output_bytes" | "logs" | "stack";

export type SandboxResult =
  | { kind: "ok"; output: unknown }
  | { kind: "script_error"; name: string; message: string }
  | { kind: "limit_exceeded"; limit: LimitName; message: string };

export type SandboxRun = {
  result: SandboxResult;
  logs: string[];
  toolCalls: ToolCallRecord[];
  durationMs: number;
};

export type SandboxOptions = {
  compiled: string;
  /** `github.getIssue` → `Github.GetIssue`. Defines the guest's entire tool surface. */
  grant: Record<string, string>;
  input: unknown;
  /** Resolves a tool call. Throwing surfaces to the guest as a rejected promise. */
  callTool: (qualifiedName: string, path: string, args: unknown) => Promise<unknown>;
  limits?: Partial<Limits>;
};

/**
 * One WASM module, reused. Each run still gets its own runtime and context via
 * `newContext()`, so heaps are never shared between runs — but compiling the
 * module costs ~100ms and is pure setup.
 */
let modulePromise: Promise<QuickJSWASMModule> | undefined;
const getModule = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC));

const jsString = (value: string) => JSON.stringify(value);

/**
 * Builds the guest's globals: an inert `z`, `defineScript`, and a context object
 * whose only tool methods are the granted ones.
 *
 * `z` can be a stub because the contract was already read out of the syntax tree at
 * validation time (see ./schema-dsl) and every check runs host-side. The guest
 * never needs a working schema library, so it doesn't get one.
 */
function prelude(grant: Record<string, string>): string {
  const namespaces = new Map<string, string[]>();
  for (const path of Object.keys(grant)) {
    const [namespace, method] = path.split(".");
    if (!namespace || !method) continue;
    namespaces.set(namespace, [...(namespaces.get(namespace) ?? []), method]);
  }

  const toolkits = [...namespaces]
    .map(([namespace, methods]) => {
      const entries = methods
        .map(
          (method) =>
            `    ${JSON.stringify(method)}: function (input) {\n` +
            `      return __callTool(${jsString(`${namespace}.${method}`)}, JSON.stringify(input === undefined ? {} : input))\n` +
            `        .then(function (text) { return JSON.parse(text); });\n` +
            `    }`,
        )
        .join(",\n");
      return `  __ctx[${JSON.stringify(namespace)}] = {\n${entries}\n  };`;
    })
    .join("\n");

  return `var ${CONFIG_GLOBAL};
function __chain() {
  var s = {};
  function f() { return s; }
  s.optional = f; s.nullable = f; s.describe = f; s.int = f; s.min = f; s.max = f;
  s.email = f; s.url = f; s.regex = f;
  return s;
}
var z = {
  string: __chain, number: __chain, int: __chain, boolean: __chain, unknown: __chain,
  object: __chain, array: __chain, enum: __chain, record: __chain, literal: __chain
};
function defineScript(config) { return config; }
var __ctx = {
  log: function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(arguments[i]);
    __log(JSON.stringify(parts));
  }
};
${toolkits}
`;
}

const ENTRY = `
Promise.resolve(${CONFIG_GLOBAL}.run(JSON.parse(__inputJson), __ctx)).then(function (value) {
  return JSON.stringify(value === undefined ? null : value);
});
`;

/** Maps QuickJS's internal errors onto the limit that produced them. */
function limitFor(name: string, message: string): LimitName | undefined {
  if (name !== "InternalError") return undefined;
  if (message.includes("interrupted")) return "cpu";
  if (message.includes("out of memory")) return "memory";
  if (message.includes("stack overflow")) return "stack";
  return undefined;
}

export async function runInSandbox(options: SandboxOptions): Promise<SandboxRun> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const startedAt = Date.now();
  const deadline = startedAt + limits.timeoutMs;

  const logs: string[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let logBytes = 0;
  let exceeded: LimitName | undefined;

  const module = await getModule();
  const context: QuickJSContext = module.newContext();
  const runtime = context.runtime;

  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  // Fires while the interpreter runs bytecode, which covers guest loops and the
  // promise job queue. It cannot preempt a host call, so `callTool` races the same
  // deadline itself below.
  runtime.setInterruptHandler(() => Date.now() > deadline);

  const finish = (result: SandboxResult): SandboxRun => ({
    result,
    logs,
    toolCalls,
    durationMs: Date.now() - startedAt,
  });

  try {
    const log = context.newFunction("__log", (handle) => {
      const text = context.getString(handle);
      if (logs.length >= limits.maxLogs || logBytes + text.length > limits.maxLogBytes) {
        exceeded ??= "logs";
        return;
      }
      logBytes += text.length;
      try {
        const parts = JSON.parse(text) as unknown[];
        logs.push(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
      } catch {
        logs.push(text);
      }
    });
    context.setProp(context.global, "__log", log);
    log.dispose();

    const callTool = context.newFunction("__callTool", (pathHandle, argsHandle) => {
      const path = context.getString(pathHandle);
      const argsJson = argsHandle ? context.getString(argsHandle) : "{}";
      const deferred = context.newPromise();

      const settle = (fn: () => void) => {
        fn();
        // Settling a promise queues guest jobs; nothing runs them otherwise.
        deferred.settled.then(() => runtime.executePendingJobs());
      };

      const reject = (message: string) =>
        settle(() => {
          const error = context.newError(message);
          deferred.reject(error);
          error.dispose();
        });

      // The grant is enforced here as well as by omission from the prelude:
      // two independent checks on the same stored list.
      const qualifiedName = options.grant[path];
      if (!qualifiedName) {
        reject(`Tool "${path}" is not in this script's grant.`);
        return deferred.handle;
      }
      if (toolCalls.length >= limits.maxToolCalls) {
        exceeded ??= "tool_calls";
        reject(`This script may make at most ${limits.maxToolCalls} tool calls.`);
        return deferred.handle;
      }

      let args: unknown;
      try {
        args = JSON.parse(argsJson);
      } catch {
        reject(`Arguments to "${path}" were not serialisable.`);
        return deferred.handle;
      }

      const callStartedAt = Date.now();
      const remaining = Math.max(0, deadline - callStartedAt);
      let timer: ReturnType<typeof setTimeout> | undefined;

      void Promise.race([
        options.callTool(qualifiedName, path, args),
        new Promise<never>((_, rejectRace) => {
          timer = setTimeout(() => {
            exceeded ??= "cpu";
            rejectRace(new Error(`"${path}" did not finish before the run deadline.`));
          }, remaining);
        }),
      ]).then(
        (value) => {
          if (timer) clearTimeout(timer);
          toolCalls.push({
            path,
            qualifiedName,
            ok: true,
            durationMs: Date.now() - callStartedAt,
          });
          settle(() => {
            const text = context.newString(JSON.stringify(value === undefined ? null : value));
            deferred.resolve(text);
            text.dispose();
          });
        },
        (error: unknown) => {
          if (timer) clearTimeout(timer);
          // Deliberately explicit rather than passing a host error through: a host
          // message reaches guest `catch` verbatim, and the guest is untrusted.
          const message = error instanceof Error ? error.message : String(error);
          toolCalls.push({
            path,
            qualifiedName,
            ok: false,
            durationMs: Date.now() - callStartedAt,
            error: message,
          });
          reject(message);
        },
      );

      return deferred.handle;
    });
    context.setProp(context.global, "__callTool", callTool);
    callTool.dispose();

    const inputJson = context.newString(JSON.stringify(options.input ?? null));
    context.setProp(context.global, "__inputJson", inputJson);
    inputJson.dispose();

    const program = prelude(options.grant) + "\n" + options.compiled + "\n" + ENTRY;
    const evaluated = context.evalCode(program, "script.js", { type: "global" });

    if (evaluated.error) {
      const dumped = context.dump(evaluated.error) as { name?: string; message?: string };
      evaluated.error.dispose();
      const name = dumped?.name ?? "Error";
      const message = dumped?.message ?? "script failed";
      const limit = exceeded ?? limitFor(name, message);
      return finish(
        limit
          ? { kind: "limit_exceeded", limit, message }
          : { kind: "script_error", name, message },
      );
    }

    // `resolvePromise` must be started before draining jobs or the await never
    // settles; see the ordering note in quickjs-emscripten's docs.
    const handle = evaluated.value;
    const pending = context.resolvePromise(handle);
    handle.dispose();

    const jobs = runtime.executePendingJobs();
    if (jobs.error) jobs.error.dispose();

    const settled = await pending;

    if (settled.error) {
      const dumped = context.dump(settled.error) as { name?: string; message?: string };
      settled.error.dispose();
      const name = dumped?.name ?? "Error";
      const message = dumped?.message ?? "script failed";
      const limit = exceeded ?? limitFor(name, message);
      return finish(
        limit
          ? { kind: "limit_exceeded", limit, message }
          : { kind: "script_error", name, message },
      );
    }

    const outputJson = context.getString(settled.value);
    if (settled.value.alive) settled.value.dispose();

    if (outputJson.length > limits.maxOutputBytes) {
      return finish({
        kind: "limit_exceeded",
        limit: "output_bytes",
        message: `Output exceeded ${limits.maxOutputBytes} bytes.`,
      });
    }

    if (exceeded) {
      return finish({ kind: "limit_exceeded", limit: exceeded, message: `Exceeded the ${exceeded} limit.` });
    }

    return finish({ kind: "ok", output: JSON.parse(outputJson) as unknown });
  } finally {
    // Dispose the context only — its runtime is an owned lifetime.
    context.dispose();
  }
}
