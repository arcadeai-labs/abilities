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
 * Builds the guest's globals: `z`, `defineScript`, and a context object whose only
 * tool methods are the granted ones.
 *
 * `z` is real here rather than a stub, because `parse()` is how a script narrows a
 * tool result the catalog does not describe — and that assertion is the script's
 * own, protecting it from its own assumption. The contract with the caller
 * (`input`/`output`) is checked host-side regardless, so nothing depends on the
 * guest running these.
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
function __with(spec, key, value) {
  var next = {};
  for (var k in spec) next[k] = spec[k];
  next[key] = value;
  return __mk(next);
}
function __mk(spec) {
  var api = {
    __spec: spec,
    parse: function (value) {
      var errors = [];
      __check(spec, value, "", errors);
      if (errors.length) throw new TypeError("schema: " + errors.slice(0, 3).join("; "));
      return value;
    },
    optional: function () { return __mk({ kind: "optional", inner: spec }); },
    nullable: function () { return __mk({ kind: "nullable", inner: spec }); },
    describe: function () { return api; },
    int: function () { return __with(spec, "int", true); },
    min: function (n) { return __with(spec, "min", n); },
    max: function (n) { return __with(spec, "max", n); },
    email: function () { return __with(spec, "format", "email"); },
    url: function () { return __with(spec, "format", "url"); },
    regex: function (re) { return __with(spec, "pattern", re.source); }
  };
  return api;
}
function __check(spec, value, path, errors) {
  var at = path || "(root)";
  function fail(m) { errors.push(at + " " + m); }
  var i, k;
  switch (spec.kind) {
    case "unknown": return;
    case "optional": if (value !== undefined) __check(spec.inner, value, path, errors); return;
    case "nullable": if (value !== null) __check(spec.inner, value, path, errors); return;
    case "string":
      if (typeof value !== "string") { fail("expected string"); return; }
      if (spec.min !== undefined && value.length < spec.min) fail("shorter than " + spec.min);
      if (spec.max !== undefined && value.length > spec.max) fail("longer than " + spec.max);
      if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) fail("does not match");
      if (spec.format === "email" && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)) fail("not an email");
      return;
    case "number":
      if (typeof value !== "number" || !isFinite(value)) { fail("expected number"); return; }
      if (spec.int && Math.floor(value) !== value) fail("expected an integer");
      if (spec.min !== undefined && value < spec.min) fail("below " + spec.min);
      if (spec.max !== undefined && value > spec.max) fail("above " + spec.max);
      return;
    case "boolean": if (typeof value !== "boolean") fail("expected boolean"); return;
    case "literal": if (value !== spec.value) fail("expected " + JSON.stringify(spec.value)); return;
    case "enum": if (spec.values.indexOf(value) < 0) fail("expected one of " + spec.values.join(", ")); return;
    case "array":
      if (!Array.isArray(value)) { fail("expected array"); return; }
      if (spec.min !== undefined && value.length < spec.min) fail("fewer than " + spec.min + " items");
      if (spec.max !== undefined && value.length > spec.max) fail("more than " + spec.max + " items");
      for (i = 0; i < value.length; i++) __check(spec.element, value[i], path + "[" + i + "]", errors);
      return;
    case "record":
      if (typeof value !== "object" || value === null || Array.isArray(value)) { fail("expected object"); return; }
      for (k in value) __check(spec.value, value[k], path ? path + "." + k : k, errors);
      return;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) { fail("expected object"); return; }
      for (k in spec.fields) __check(spec.fields[k], value[k], path ? path + "." + k : k, errors);
      return;
  }
}
var z = {
  string: function () { return __mk({ kind: "string" }); },
  number: function () { return __mk({ kind: "number" }); },
  int: function () { return __mk({ kind: "number", int: true }); },
  boolean: function () { return __mk({ kind: "boolean" }); },
  unknown: function () { return __mk({ kind: "unknown" }); },
  literal: function (v) { return __mk({ kind: "literal", value: v }); },
  enum: function (values) { return __mk({ kind: "enum", values: values }); },
  array: function (el) { return __mk({ kind: "array", element: el.__spec }); },
  record: function (v) { return __mk({ kind: "record", value: v.__spec }); },
  object: function (shape) {
    var fields = {};
    for (var k in shape) fields[k] = shape[k].__spec;
    return __mk({ kind: "object", fields: fields });
  }
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
