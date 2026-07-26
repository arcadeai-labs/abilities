/**
 * The syntactic half of validation: what a script is allowed to say, and which
 * tools it thereby asks for.
 *
 * This runs before the type checker, on a bare `SourceFile`, and it carries the
 * load-bearing security job of the static pass: deriving the capability grant.
 * Types are erased and the checker can be lied to, so the grant is never taken
 * from a type — it comes from the shape of the code, and the rules below exist to
 * keep that shape unambiguous.
 */

import ts from "typescript";
import { RESERVED_CTX_KEYS } from "./naming";

export const RUNTIME_MODULE = "arcade:runtime";

export type Severity = "error" | "warning";

export type Diagnostic = {
  /** `policy` here; the checker contributes `type`, the contract check `contract`. */
  category: "policy" | "type" | "contract";
  code: string;
  severity: Severity;
  message: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type PolicyResult = {
  diagnostics: Diagnostic[];
  /** Toolkit namespaces destructured from `run`'s context parameter. */
  namespaces: string[];
  /** `github.getIssue` paths actually called. */
  paths: string[];
};

const position = (file: ts.SourceFile, offset: number) => {
  const { line, character } = file.getLineAndCharacterOfPosition(offset);
  return { line: line + 1, column: character + 1 };
};

/** Anything the guest could use to reach beyond the declared tool surface. */
const FORBIDDEN_IDENTIFIERS = new Map([
  ["eval", "policy/no-eval"],
  ["Function", "policy/no-function-constructor"],
  ["require", "policy/no-require"],
  ["process", "policy/no-process"],
  ["globalThis", "policy/no-global-this"],
  ["fetch", "policy/no-fetch"],
  ["WebAssembly", "policy/no-webassembly"],
]);

export function checkPolicy(file: ts.SourceFile): PolicyResult {
  const diagnostics: Diagnostic[] = [];
  const namespaces: string[] = [];
  const paths = new Set<string>();

  const report = (node: ts.Node, code: string, message: string, severity: Severity = "error") =>
    diagnostics.push({
      category: "policy",
      code,
      severity,
      message,
      start: position(file, node.getStart(file)),
      end: position(file, node.getEnd()),
    });

  // ── imports ──────────────────────────────────────────────────────────────
  // A script imports nothing at all: `z`, `defineScript` and every toolkit are
  // ambient (see ./codegen). That keeps the module graph closed by construction —
  // a second module could call tools the grant never named — and leaves no
  // allow-listed specifier for anything to hide behind.
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      report(
        statement,
        "policy/no-import",
        "A script imports nothing; toolkits, `z` and `defineScript` are already in scope.",
      );
      continue;
    }
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      report(statement, "policy/no-export", "A script exports nothing.");
    }
  }

  // ── the defineScript call ────────────────────────────────────────────────
  const call = file.statements
    .filter(ts.isExpressionStatement)
    .map((statement) => statement.expression)
    .find(
      (expression): expression is ts.CallExpression =>
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "defineScript",
    );

  if (!call) {
    diagnostics.push({
      category: "policy",
      code: "policy/missing-define-script",
      severity: "error",
      message: "A script must be a single `defineScript({ ... })` call.",
      start: { line: 1, column: 1 },
      end: { line: 1, column: 1 },
    });
  }

  // ── run(), and the grant it declares ─────────────────────────────────────
  const config = call?.arguments[0];
  const runProperty =
    config && ts.isObjectLiteralExpression(config)
      ? config.properties.find(
          (property) =>
            (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) &&
            property.name !== undefined &&
            ts.isIdentifier(property.name) &&
            property.name.text === "run",
        )
      : undefined;

  const runFunction: ts.SignatureDeclaration | undefined = (() => {
    if (!runProperty) return undefined;
    if (ts.isMethodDeclaration(runProperty)) return runProperty;
    if (ts.isPropertyAssignment(runProperty)) {
      const initializer = runProperty.initializer;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer;
    }
    return undefined;
  })();

  if (config && !runFunction) {
    report(
      config,
      "policy/missing-run",
      "`defineScript` needs a `run` function: `async run(input, { ...toolkits, log }) { ... }`.",
    );
  }

  const bindings = new Map<string, ts.BindingElement>();

  if (runFunction) {
    const contextParameter = runFunction.parameters[1];
    if (!contextParameter) {
      report(
        runFunction,
        "policy/missing-context-parameter",
        "`run` takes the context as its second parameter; destructure the toolkits you need, e.g. `async run(input, { github, log })`.",
      );
    } else if (!ts.isObjectBindingPattern(contextParameter.name)) {
      // The grant is read off the binding pattern, so it has to be one.
      report(
        contextParameter,
        "policy/context-must-be-destructured",
        "The context parameter must be destructured so the toolkits a script uses are declared, e.g. `{ github, log }`.",
      );
    } else {
      for (const element of contextParameter.name.elements) {
        if (element.dotDotDotToken) {
          report(
            element,
            "policy/no-context-rest",
            "A rest element would grant every toolkit at once; name the toolkits you need instead.",
          );
          continue;
        }
        const source = element.propertyName ?? element.name;
        if (!ts.isIdentifier(source)) {
          report(element, "policy/computed-context-key", "Context keys must be plain identifiers.");
          continue;
        }
        if (RESERVED_CTX_KEYS.has(source.text)) continue;
        if (!ts.isIdentifier(element.name)) {
          report(
            element,
            "policy/no-nested-destructure",
            "Bind the toolkit itself; destructuring inside it hides which tools are used.",
          );
          continue;
        }
        namespaces.push(source.text);
        bindings.set(element.name.text, element);
      }
    }
  }

  // ── how a toolkit binding may be used ────────────────────────────────────
  // Restricting it to `binding.method(...)` is what makes the extracted grant
  // sound: any other use could reach a tool this pass can't see.
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const forbidden = FORBIDDEN_IDENTIFIERS.get(node.text);
      // Only a *value reference* is a problem. `{ eval: 1 }` and `x.process` name a
      // property and reach nothing — but `process.env` is a reference, so it is not
      // enough to skip every identifier that happens to sit beside a dot.
      const isPropertyName =
        (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (ts.isQualifiedName(node.parent) && node.parent.right === node);
      const isDeclaredName =
        (ts.isPropertyAssignment(node.parent) ||
          ts.isPropertySignature(node.parent) ||
          ts.isMethodDeclaration(node.parent) ||
          ts.isBindingElement(node.parent) ||
          ts.isVariableDeclaration(node.parent) ||
          ts.isParameter(node.parent) ||
          ts.isFunctionDeclaration(node.parent)) &&
        node.parent.name === node;

      if (forbidden && !isPropertyName && !isDeclaredName) {
        report(node, forbidden, `\`${node.text}\` is not available to a script.`);
      }

      if (bindings.has(node.text) && !ts.isBindingElement(node.parent)) {
        const parent = node.parent;
        const isDirectCall =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          ts.isIdentifier(parent.name) &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent;

        if (isDirectCall) {
          const access = parent as ts.PropertyAccessExpression;
          const namespace = (bindings.get(node.text)!.propertyName ?? bindings.get(node.text)!.name) as ts.Identifier;
          paths.add(`${namespace.text}.${(access.name as ts.Identifier).text}`);
        } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
          report(
            parent,
            "policy/computed-tool-access",
            `Computed access hides which tool is called. Write \`${node.text}.toolName(...)\` directly.`,
          );
        } else {
          report(
            node,
            "policy/toolkit-must-be-called-directly",
            `\`${node.text}\` may only be used as \`${node.text}.toolName(...)\`. Aliasing it or passing it around would hide which tools this script uses.`,
          );
        }
      }
    }

    // Type-level computation is the one way untrusted source can attack the
    // *validator* rather than the runtime: recursive conditional or mapped types
    // make the checker take exponential time, and it runs in our process. Rather
    // than try to bound that, remove the capability — a script has no business
    // declaring types, only annotating with existing ones. Everything expensive
    // then lives in the generated prelude, which is fixed and known-cheap.
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      report(
        node,
        "policy/no-type-declaration",
        "Scripts may annotate with existing types but not declare new ones. Use `z.…` for shapes.",
      );
    }
    if (ts.isClassLike(node)) {
      report(node, "policy/no-class", "Class declarations are not allowed in a script.");
    }
    if (
      node.kind === ts.SyntaxKind.ConditionalType ||
      node.kind === ts.SyntaxKind.MappedType ||
      node.kind === ts.SyntaxKind.InferType ||
      node.kind === ts.SyntaxKind.TemplateLiteralType
    ) {
      report(
        node,
        "policy/no-type-computation",
        "Computed types are not allowed; they let a script make type checking arbitrarily expensive.",
      );
    }

    if (ts.isWithStatement(node)) report(node, "policy/no-with", "`with` is not allowed.");
    if (ts.isDebuggerStatement(node)) report(node, "policy/no-debugger", "`debugger` is not allowed.");
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      report(node, "policy/no-function-constructor", "`new Function` is not allowed.");
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "policy/no-dynamic-import", "Dynamic `import()` is not allowed.");
    }
    // `as any` and `!` would let the author opt out of the very checks that make
    // storing an unexecuted script meaningful.
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.kind === ts.SyntaxKind.AnyKeyword
    ) {
      report(node, "policy/no-any-assertion", "`as any` defeats the contract check.");
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      report(node, "policy/no-any", "`any` defeats the contract check; use `unknown` and narrow it.");
    }
    if (ts.isNonNullExpression(node)) {
      report(
        node,
        "policy/no-non-null-assertion",
        "`!` asserts away a value the catalog says may be absent; handle the absent case instead.",
      );
    }

    ts.forEachChild(node, walk);
  };
  walk(file);

  // ── suppression comments ─────────────────────────────────────────────────
  const text = file.getFullText();
  for (const match of text.matchAll(/@ts-(ignore|expect-error|nocheck)/g)) {
    const at = position(file, match.index);
    diagnostics.push({
      category: "policy",
      code: "policy/no-suppression",
      severity: "error",
      message: `\`@ts-${match[1]}\` would suppress the checks that let this script be stored without running it.`,
      start: at,
      end: at,
    });
  }

  return { diagnostics, namespaces: [...new Set(namespaces)], paths: [...paths] };
}
