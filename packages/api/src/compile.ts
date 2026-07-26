/**
 * Turns validated source into something the sandbox can evaluate.
 *
 * Only two edits are needed, and both are safe precisely because validation
 * already ran: the single `arcade:runtime` import is dropped (the prelude provides
 * those bindings as globals instead, so the guest needs no module loader at all),
 * and `export default` becomes an assignment. Type annotations are then erased.
 *
 * This is a transform over the syntax tree rather than string surgery on purpose —
 * splicing untrusted text is how a template injection gets in.
 */

import ts from "typescript";

/** Global the prelude reads the script's config from. */
export const CONFIG_GLOBAL = "__config";

export function compileScript(source: string): string {
  const file = ts.createSourceFile("/script.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
    const { factory } = context;
    const statements = root.statements.map((statement) => {
      // Validation guarantees the module is exactly one `defineScript({ … })`
      // expression statement; binding its result is all the guest needs.
      if (
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === "defineScript"
      ) {
        return factory.createExpressionStatement(
          factory.createAssignment(factory.createIdentifier(CONFIG_GLOBAL), statement.expression),
        );
      }
      return statement;
    });

    return factory.updateSourceFile(root, statements);
  };

  const transformed = ts.transform(file, [transformer]);
  const printed = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(
    transformed.transformed[0]!,
  );
  transformed.dispose();

  // No imports or exports survive, so this is a plain script.
  return ts.transpileModule(printed, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
}
