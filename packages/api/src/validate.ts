/**
 * Decides whether a script is valid, without running any of it.
 *
 * Three passes, in order, because each depends on the last:
 *  1. {@link checkPolicy} on the bare syntax tree — closes the module graph and
 *     reads the capability grant off `run`'s destructured context parameter.
 *  2. codegen for exactly the toolkits that grant names, so the compiler sees the
 *     tools the script asked for and nothing else.
 *  3. the type checker, over an in-memory file system holding only `lib.es2022`,
 *     the generated declarations and the script. No `@types/node`, no DOM.
 *
 * Passing means the script conforms to its declared contract and can only reach
 * the tools in its grant. It does *not* mean the script is safe to run — that is
 * the sandbox's job, and it assumes this pass was defeated.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { loadCatalog } from "./catalog";
import { generateTypes } from "./codegen";
import { checkPolicy, type Diagnostic, RUNTIME_MODULE } from "./policy";
import { DslError, interpretSpec, type Spec } from "./schema-dsl";
import { hasTypedOutput } from "./value-schema";

/** A script long enough to be a denial-of-service attempt rather than glue code. */
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_NODES = 20_000;

const SCRIPT_PATH = "/script.ts";
const TYPES_PATH = "/arcade-runtime.d.ts";
const LIB = "lib.es2022.d.ts";
const LIB_DIR = dirname(ts.getDefaultLibFilePath({}));

export type ToolCoverage = { path: string; qualifiedName: string; typed: boolean };

export type Contract = { input: Spec; output: Spec; expect: Record<string, Spec> };

export type ValidationResult = {
  ok: boolean;
  snapshotId: string;
  diagnostics: Diagnostic[];
  /** Toolkit namespaces the script destructured. */
  namespaces: string[];
  /** Upstream qualified names the script may call. The runtime allowlist. */
  grant: string[];
  /** `github.getIssue` → `Github.GetIssue`, for the sandbox bridge. */
  paths: Record<string, string>;
  /** Which granted tools declare an output shape upstream. */
  outputCoverage: ToolCoverage[];
  contract: Contract | null;
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

/** Pulls `input`, `output` and `expect` out of the config without evaluating it. */
function readContract(file: ts.SourceFile): { contract: Contract | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const at = (node: ts.Node) => {
    const start = file.getLineAndCharacterOfPosition(node.getStart(file));
    const end = file.getLineAndCharacterOfPosition(node.getEnd());
    return { start: point(start.line + 1, start.character + 1), end: point(end.line + 1, end.character + 1) };
  };

  const exportAssignment = file.statements.find(ts.isExportAssignment);
  const call = exportAssignment && ts.isCallExpression(exportAssignment.expression) ? exportAssignment.expression : undefined;
  const config = call?.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) return { contract: null, diagnostics };

  const property = (name: string) =>
    config.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === name,
    );

  const readSpec = (name: string): Spec | null => {
    const assignment = property(name);
    if (!assignment) return null;
    try {
      return interpretSpec(assignment.initializer).spec;
    } catch (error) {
      if (error instanceof DslError) {
        diagnostics.push({
          category: "contract",
          code: "contract/unreadable-schema",
          severity: "error",
          message: `\`${name}\`: ${error.message}`,
          ...at(error.node),
        });
        return null;
      }
      throw error;
    }
  };

  const input = readSpec("input");
  const output = readSpec("output");

  const expect: Record<string, Spec> = {};
  const expectAssignment = property("expect");
  if (expectAssignment) {
    if (!ts.isObjectLiteralExpression(expectAssignment.initializer)) {
      diagnostics.push({
        category: "contract",
        code: "contract/unreadable-expect",
        severity: "error",
        message: "`expect` must be an object literal mapping tool paths to schemas.",
        ...at(expectAssignment.initializer),
      });
    } else {
      for (const entry of expectAssignment.initializer.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;
        const path = ts.isStringLiteralLike(entry.name)
          ? entry.name.text
          : ts.isIdentifier(entry.name)
            ? entry.name.text
            : null;
        if (path === null) continue;
        try {
          expect[path] = interpretSpec(entry.initializer).spec;
        } catch (error) {
          if (!(error instanceof DslError)) throw error;
          diagnostics.push({
            category: "contract",
            code: "contract/unreadable-schema",
            severity: "error",
            message: `\`expect["${path}"]\`: ${error.message}`,
            ...at(error.node),
          });
        }
      }
    }
  }

  if (!input || !output) return { contract: null, diagnostics };
  return { contract: { input, output, expect }, diagnostics };
}

export async function validateScript(source: string): Promise<ValidationResult> {
  const catalog = await loadCatalog();
  const empty: ValidationResult = {
    ok: false,
    snapshotId: catalog.snapshotId,
    diagnostics: [],
    namespaces: [],
    grant: [],
    paths: {},
    outputCoverage: [],
    contract: null,
  };

  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    return {
      ...empty,
      diagnostics: [
        {
          category: "policy",
          code: "policy/source-too-large",
          severity: "error",
          message: `A script may be at most ${MAX_SOURCE_BYTES / 1024}KiB.`,
          start: point(1, 1),
          end: point(1, 1),
        },
      ],
    };
  }

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

  // ── 1. policy and the grant ──────────────────────────────────────────────
  const policy = checkPolicy(file);
  const contract = readContract(file);
  const diagnostics: Diagnostic[] = [...policy.diagnostics, ...contract.diagnostics];

  const known = new Set(catalog.nameMap.namespaces.keys());
  const namespaces = policy.namespaces.filter((namespace) => {
    if (known.has(namespace)) return true;
    const suggestion = closest(namespace, known);
    diagnostics.push({
      category: "policy",
      code: "policy/unknown-toolkit",
      severity: "error",
      message: `No toolkit \`${namespace}\` in this catalog snapshot.${suggestion ? ` Did you mean \`${suggestion}\`?` : ""}`,
      start: point(1, 1),
      end: point(1, 1),
    });
    return false;
  });

  // ── 2. types for exactly those toolkits ──────────────────────────────────
  const scoped = namespaces.flatMap((namespace) => catalog.byNamespace.get(namespace) ?? []);
  const generated = generateTypes(scoped, catalog.nameMap);

  // ── 3. the type check ────────────────────────────────────────────────────
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
    diagnostics.push({
      category: "type",
      code: `TS${diagnostic.code}`,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      start: point(from.line + 1, from.character + 1),
      end: point(to.line + 1, to.character + 1),
    });
  }

  // ── the grant, resolved ──────────────────────────────────────────────────
  const paths: Record<string, string> = {};
  const outputCoverage: ToolCoverage[] = [];
  const byQualifiedName = new Map(catalog.rows.map((row) => [row.qualifiedName, row] as const));

  for (const path of policy.paths) {
    const binding = catalog.nameMap.byPath.get(path);
    // An unresolvable path is already a type error ("property does not exist"),
    // so it needs no second diagnostic — but it must not reach the grant.
    if (!binding) continue;
    paths[path] = binding.qualifiedName;
    outputCoverage.push({
      path,
      qualifiedName: binding.qualifiedName,
      typed: hasTypedOutput(byQualifiedName.get(binding.qualifiedName)?.output),
    });
  }

  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error");

  return {
    ok,
    snapshotId: catalog.snapshotId,
    diagnostics,
    namespaces,
    grant: [...new Set(Object.values(paths))].sort(),
    paths,
    outputCoverage: outputCoverage.sort((a, b) => a.path.localeCompare(b.path)),
    contract: contract.contract,
  };
}

export { RUNTIME_MODULE };
