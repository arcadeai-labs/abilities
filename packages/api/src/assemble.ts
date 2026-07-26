/**
 * Builds the module that gets type-checked, from stored parameters.
 *
 * An author submits a contract as JSON and a single `run` method as text. Neither
 * is a module, so nothing they write can import anything — the toolkits, `z` and
 * `defineScript` are all ambient (see ./codegen), which is what lets the policy
 * pass reject imports outright instead of allow-listing one.
 *
 * The `run` text is spliced at column 1 on its own lines, so a diagnostic's column
 * is already correct and only its line needs shifting. Splicing is done against a
 * parse of the assembled result rather than trusted as text: if the method body
 * closed itself early it would become top-level code, and {@link checkAssembly}
 * is what notices.
 */

import ts from "typescript";
import { type JsonSchema, JsonSchemaError, specFromJsonSchema, specToSource } from "./json-schema";
import type { Diagnostic } from "./policy";
import type { Spec } from "./schema-dsl";

export type ScriptParams = {
  /** JSON Schema for the run input. */
  input: JsonSchema;
  /** JSON Schema the return value must satisfy. */
  output: JsonSchema;
  /**
   * Toolkits to put in scope, by namespace: `["gmail", "linear"]`.
   *
   * This is what `run`'s context object contains, and what codegen emits types
   * for. It is *not* the capability grant — which tools the script may actually
   * call, and therefore which OAuth scopes get requested, still follows from the
   * `toolkit.method(...)` calls it makes.
   */
  toolkits?: string[];
  /** `async run(input, { github, log }) { … }` */
  run: string;
};

export type Contract = { input: Spec; output: Spec };

export type Assembled = {
  source: string;
  contract: Contract;
  /** Lines of generated preamble before `run` begins; subtract to get author coordinates. */
  runLineOffset: number;
};

/** Fails with diagnostics rather than throwing, so the caller can report them all. */
export type AssembleResult =
  | { ok: true; assembled: Assembled }
  | { ok: false; diagnostics: Diagnostic[] };

const at = (line = 1, column = 1) => ({ start: { line, column }, end: { line, column } });

const contractError = (message: string, code = "contract/invalid-schema"): Diagnostic => ({
  category: "contract",
  code,
  severity: "error",
  message,
  ...at(),
});

export function assemble(params: ScriptParams): AssembleResult {
  const { contract, diagnostics } = contractFrom(params);

  if (typeof params.run !== "string" || params.run.trim() === "") {
    diagnostics.push(
      contractError("`run` must be the method source, e.g. `async run(input, { log }) { … }`.", "contract/missing-run"),
    );
  }

  if (!contract || diagnostics.length > 0) return { ok: false, diagnostics };

  const preamble = [
    "defineScript({",
    `input: ${specToSource(contract.input)},`,
    `output: ${specToSource(contract.output)},`,
  ];

  const source = [...preamble, params.run.replace(/\s+$/, ""), "});", ""].join("\n");

  return { ok: true, assembled: { source, contract, runLineOffset: preamble.length } };
}

/**
 * Turns the submitted JSON Schemas into the IR the runtime validator checks
 * against.
 *
 * Both the write path and the run path call this, so the contract enforced on a
 * live run is derived exactly like the one that was type-checked. That is why it is
 * worth deriving per run rather than storing a copy: there is no second code path
 * for a stored copy to drift from, and the conversion is pure string-shuffling.
 */
export function contractFrom(params: ScriptParams): {
  contract: Contract | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  const read = (schema: JsonSchema | undefined, label: string): Spec | null => {
    try {
      return specFromJsonSchema(schema, label);
    } catch (error) {
      if (!(error instanceof JsonSchemaError)) throw error;
      diagnostics.push(contractError(`\`${label}\`: ${error.message} (at ${error.path})`));
      return null;
    }
  };

  const input = read(params.input, "input");
  const output = read(params.output, "output");

  return { contract: input && output ? { input, output } : null, diagnostics };
}

/**
 * Confirms the spliced text really is one method and nothing else.
 *
 * Text substitution into generated code is a template injection: a `run` value
 * ending the method early would put arbitrary statements at the top level of the
 * assembled module. The policy pass runs over that assembled module and rejects
 * anything unexpected, so an escape is caught either way — but saying so here
 * produces the error the author can act on.
 */
export function checkAssembly(file: ts.SourceFile): Diagnostic[] {
  const statements = file.statements;
  const only = statements.length === 1 ? statements[0] : undefined;

  const isDefineScriptCall =
    only !== undefined &&
    ts.isExpressionStatement(only) &&
    ts.isCallExpression(only.expression) &&
    ts.isIdentifier(only.expression.expression) &&
    only.expression.expression.text === "defineScript";

  if (isDefineScriptCall) return [];

  return [
    {
      category: "policy",
      code: "policy/run-must-be-one-method",
      severity: "error",
      message:
        "`run` must be exactly one method — `async run(input, { … }) { … }` — and nothing after it.",
      ...at(),
    },
  ];
}

/**
 * Shifts a diagnostic from assembled-module coordinates into the author's `run`.
 *
 * Anything landing in the generated preamble is reported against the contract
 * instead: those lines are ours, so a type error there is about the schemas the
 * author supplied, not about code they wrote.
 */
export function toAuthorCoordinates(diagnostic: Diagnostic, runLineOffset: number): Diagnostic {
  if (diagnostic.start.line <= runLineOffset) {
    return {
      ...diagnostic,
      category: "contract",
      message: `${diagnostic.message} (in the declared \`input\` or \`output\`)`,
      ...at(),
    };
  }
  return {
    ...diagnostic,
    start: { ...diagnostic.start, line: diagnostic.start.line - runLineOffset },
    end: { ...diagnostic.end, line: Math.max(1, diagnostic.end.line - runLineOffset) },
  };
}
