/**
 * Decides whether a script is valid, without running any of it.
 *
 * Four passes, in order, because each depends on the last:
 *  1. {@link assemble} turns the submitted contract and `run` method into a module.
 *  2. {@link checkAssembly} and {@link checkPolicy} on the bare syntax tree — they
 *     confirm the spliced method really is one method, close the module graph, and
 *     read the capability grant off `run`'s destructured context parameter.
 *  3. codegen for exactly the toolkits that grant names, so the compiler sees the
 *     tools the script asked for and nothing else.
 *  4. the type checker, over an in-memory file system holding only `lib.es2022`,
 *     the generated declarations and the script. No `@types/node`, no DOM.
 *
 * Passing means the script conforms to its declared contract and can only reach
 * the tools in its grant. It does *not* mean the script is safe to run — that is
 * the sandbox's job, and it assumes this pass was defeated.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import {
  assemble,
  checkAssembly,
  type Contract,
  type ScriptParams,
  toAuthorCoordinates,
} from "./assemble";
import { loadCatalog } from "./catalog";
import { generateTypes } from "./codegen";
import { checkPolicy, type Diagnostic } from "./policy";
import { hasTypedOutput } from "./value-schema";

/** A `run` method long enough to be a denial-of-service attempt rather than glue code. */
const MAX_RUN_BYTES = 64 * 1024;
const MAX_NODES = 20_000;

const SCRIPT_PATH = "/script.ts";
const TYPES_PATH = "/arcade-runtime.d.ts";
const LIB = "lib.es2022.d.ts";
const LIB_DIR = dirname(ts.getDefaultLibFilePath({}));

export type ToolCoverage = { path: string; qualifiedName: string; typed: boolean };

export type ValidationResult = {
  ok: boolean;
  snapshotId: string;
  diagnostics: Diagnostic[];
  /** Toolkits put in scope, as declared in the request body. */
  namespaces: string[];
  /**
   * `github.getIssue` → `Github.GetIssue`. The capability grant: which tools the
   * script may call, and what each resolves to upstream. `Object.values` is the
   * list of upstream tools, so there is no separate array.
   */
  grant: Record<string, string>;
  /** Which granted tools declare an output shape upstream. */
  outputCoverage: ToolCoverage[];
  contract: Contract | null;
  /** The assembled module, for storage. Null when assembly failed. */
  source: string | null;
};

const point = (line: number, column: number) => ({ line, column });

/** Serves the virtual files, plus TypeScript's own lib files and nothing else. */
function createHost(files: Map<string, string>): ts.CompilerHost {
  const isLib = (fileName: string) => fileName.startsWith(LIB_DIR) && fileName.endsWith(".d.ts");
  const read = (fileName: string): string | undefined => {
    const virtual = files.get(fileName);
    if (virtual !== undefined) return virtual;
    if (!isLib(fileName)) return undefined;
    try {
      return readFileSync(fileName, "utf8");
    } catch {
      return undefined;
    }
  };

  return {
    getSourceFile: (fileName, languageVersion) => {
      const text = read(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: () => join(LIB_DIR, LIB),
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => read(fileName) !== undefined,
    readFile: read,
    directoryExists: () => true,
    getDirectories: () => [],
  };
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2022,
  lib: [LIB],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  // The generated declarations are ours and known-good; checking them again on
  // every request is pure cost.
  skipLibCheck: true,
  // Load no ambient type packages at all — `@types/node` would hand a script
  // `process`, `Buffer` and friends at the type level.
  types: [],
  allowJs: false,
  noImplicitOverride: true,
};

function countNodes(file: ts.SourceFile): number {
  let total = 0;
  const walk = (node: ts.Node) => {
    total++;
    if (total <= MAX_NODES) ts.forEachChild(node, walk);
  };
  walk(file);
  return total;
}

/** Levenshtein, bounded — only used to suggest a toolkit name. */
function closest(target: string, candidates: Iterable<string>): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const rows = [Array.from({ length: candidate.length + 1 }, (_, i) => i)];
    for (let i = 1; i <= target.length; i++) {
      const row = [i];
      for (let j = 1; j <= candidate.length; j++) {
        row[j] = Math.min(
          rows[i - 1]![j]! + 1,
          row[j - 1]! + 1,
          rows[i - 1]![j - 1]! + (target[i - 1] === candidate[j - 1] ? 0 : 1),
        );
      }
      rows.push(row);
    }
    const distance = rows[target.length]![candidate.length]!;
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best && best.distance <= Math.max(2, Math.floor(target.length / 3)) ? best.name : undefined;
}

export async function validateScript(params: ScriptParams): Promise<ValidationResult> {
  const catalog = await loadCatalog();
  const empty: ValidationResult = {
    ok: false,
    snapshotId: catalog.snapshotId,
    diagnostics: [],
    namespaces: [],
    grant: {},
    outputCoverage: [],
    contract: null,
    source: null,
  };

  if (typeof params.run === "string" && Buffer.byteLength(params.run, "utf8") > MAX_RUN_BYTES) {
    return {
      ...empty,
      diagnostics: [
        {
          category: "policy",
          code: "policy/source-too-large",
          severity: "error",
          message: `\`run\` may be at most ${MAX_RUN_BYTES / 1024}KiB.`,
          start: point(1, 1),
          end: point(1, 1),
        },
      ],
    };
  }

  // ── 1. assemble ──────────────────────────────────────────────────────────
  const assembly = assemble(params);
  if (!assembly.ok) return { ...empty, diagnostics: assembly.diagnostics };
  const { source, contract, runLineOffset } = assembly.assembled;

  const file = ts.createSourceFile(SCRIPT_PATH, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  if (countNodes(file) > MAX_NODES) {
    return {
      ...empty,
      diagnostics: [
        {
          category: "policy",
          code: "policy/source-too-complex",
          severity: "error",
          message: `A script may contain at most ${MAX_NODES} syntax nodes.`,
          start: point(1, 1),
          end: point(1, 1),
        },
      ],
    };
  }

  // ── 2. the declared toolkits ─────────────────────────────────────────────
  // These come from the request body, not from the code, so codegen no longer
  // needs a parse to know what to emit. What the script may *call* within them is
  // still read off the source below.
  const known = new Set(catalog.nameMap.namespaces.keys());
  const raw: Diagnostic[] = [];
  const namespaces: string[] = [];

  for (const namespace of new Set(params.toolkits ?? [])) {
    if (known.has(namespace)) {
      namespaces.push(namespace);
      continue;
    }
    const suggestion = closest(namespace, known);
    raw.push({
      category: "contract",
      code: "contract/unknown-toolkit",
      severity: "error",
      message: `\`toolkits\` names \`${namespace}\`, which is not in this catalog snapshot.${suggestion ? ` Did you mean \`${suggestion}\`?` : ""}`,
      start: point(1, 1),
      end: point(1, 1),
    });
  }
  namespaces.sort();

  // ── 3. shape and policy ──────────────────────────────────────────────────
  const structural = checkAssembly(file);
  const policy = checkPolicy(file, new Set(namespaces));
  raw.push(...structural, ...policy.diagnostics);

  // ── 4. types for exactly those toolkits ──────────────────────────────────
  const scoped = namespaces.flatMap((namespace) => catalog.byNamespace.get(namespace) ?? []);
  const generated = generateTypes(scoped, catalog.nameMap);

  // ── 5. the type check ────────────────────────────────────────────────────
  const files = new Map([
    [SCRIPT_PATH, source],
    [TYPES_PATH, generated.source],
  ]);
  const program = ts.createProgram({
    rootNames: [TYPES_PATH, SCRIPT_PATH],
    options: COMPILER_OPTIONS,
    host: createHost(files),
  });
  const scriptFile = program.getSourceFile(SCRIPT_PATH)!;

  for (const diagnostic of [
    ...program.getSyntacticDiagnostics(scriptFile),
    ...program.getSemanticDiagnostics(scriptFile),
  ]) {
    const start = diagnostic.start ?? 0;
    const from = scriptFile.getLineAndCharacterOfPosition(start);
    const to = scriptFile.getLineAndCharacterOfPosition(start + (diagnostic.length ?? 0));
    raw.push({
      category: "type",
      code: `TS${diagnostic.code}`,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      start: point(from.line + 1, from.character + 1),
      end: point(to.line + 1, to.character + 1),
    });
  }

  // Everything above is in assembled-module coordinates; the author only ever saw
  // their own `run` method.
  const diagnostics = raw.map((diagnostic) => toAuthorCoordinates(diagnostic, runLineOffset));

  // ── the grant, resolved ──────────────────────────────────────────────────
  const grant: Record<string, string> = {};
  const outputCoverage: ToolCoverage[] = [];
  const byQualifiedName = new Map(catalog.rows.map((row) => [row.qualifiedName, row] as const));

  for (const path of policy.paths) {
    const binding = catalog.nameMap.byPath.get(path);
    // An unresolvable path is already a type error ("property does not exist"),
    // so it needs no second diagnostic — but it must not reach the grant.
    if (!binding) continue;
    grant[path] = binding.qualifiedName;
    outputCoverage.push({
      path,
      qualifiedName: binding.qualifiedName,
      typed: hasTypedOutput(byQualifiedName.get(binding.qualifiedName)?.output),
    });
  }

  // A declared toolkit that is never called grants nothing — the guest's tool
  // surface is built from `grant`, not from this list — so say so rather than
  // leaving a declaration that looks like it does something.
  for (const namespace of namespaces) {
    if (Object.keys(grant).some((path) => path.startsWith(`${namespace}.`))) continue;
    diagnostics.push({
      category: "contract",
      code: "contract/unused-toolkit",
      severity: "warning",
      message: `\`toolkits\` names \`${namespace}\`, but no \`${namespace}.…\` call is made, so it grants nothing.`,
      start: point(1, 1),
      end: point(1, 1),
    });
  }


  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error");

  return {
    ok,
    snapshotId: catalog.snapshotId,
    diagnostics,
    namespaces,
    grant,
    outputCoverage: outputCoverage.sort((a, b) => a.path.localeCompare(b.path)),
    contract,
    source,
  };
}

export type { Contract, ScriptParams };
