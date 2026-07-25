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
    const statements: ts.Statement[] = [];

    for (const statement of root.statements) {
      // Validation guarantees the only import is `arcade:runtime`, whose bindings
      // the prelude defines directly.
      if (ts.isImportDeclaration(statement)) continue;

      if (ts.isExportAssignment(statement)) {
        statements.push(
          factory.createExpressionStatement(
            factory.createAssignment(factory.createIdentifier(CONFIG_GLOBAL), statement.expression),
          ),
        );
        continue;
      }

      statements.push(statement);
    }

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
