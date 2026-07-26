/**
 * Renders the mirrored catalog as the `arcade:runtime` module that scripts are
 * written and type-checked against.
 *
 * The same text is served by `GET /api/types` for authors to read and fed to the
 * compiler by `POST /api/validate`, so what you read is exactly what gets checked.
 */

import { buildNameMap, type NameMap, type ToolBinding } from "./naming";
import {
  isSpecified,
  requiredKeys,
  type ToolInput,
  type ToolOutput,
  type ValueSchema,
} from "./value-schema";

/** Nesting seen upstream tops out at five; the cap only guards against cycles. */
const MAX_DEPTH = 12;
const INDENT = "  ";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

/** Drops one indent level; the emitted declarations are no longer inside a module block. */
const dedent = (line: string) => (line.startsWith(INDENT) ? line.slice(INDENT.length) : line);

/** Wraps in parens only when appending `[]` would otherwise bind too loosely. */
const arrayOf = (element: string) =>
  /[|&]/.test(element) || element.includes("\n") ? `Array<${element}>` : `${element}[]`;

function docComment(text: string | undefined, indent: string): string[] {
  if (!text?.trim()) return [];
  const lines = text.trim().split("\n");
  if (lines.length === 1) return [`${indent}/** ${lines[0]!.trim()} */`];
  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} * ${line.trim()}`),
    `${indent} */`,
  ];
}

/**
 * Emits an object type from a `properties` map.
 *
 * Requiredness follows {@link requiredKeys}: when upstream declares no required
 * keys every property is optional, which surfaces the under-specification in the
 * type rather than promising fields that may not arrive.
 */
function emitObject(
  properties: Record<string, ValueSchema>,
  required: Set<string>,
  indent: string,
  depth: number,
): string {
  const inner = indent + INDENT;
  const lines: string[] = ["{"];

  for (const name of Object.keys(properties).sort()) {
    const schema = properties[name]!;
    lines.push(...docComment(schema.description, inner));
    const optional = required.has(name) ? "" : "?";
    lines.push(`${inner}${key(name)}${optional}: ${emitType(schema, inner, depth + 1)};`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** One `ValueSchema` as a TypeScript type. Unspecified shapes become `unknown`. */
export function emitType(schema: ValueSchema | undefined, indent = "", depth = 0): string {
  if (!schema || depth > MAX_DEPTH) return "unknown";

  const base = ((): string => {
    switch (schema.val_type) {
      case "string":
        return schema.enum?.length
          ? schema.enum.map((value) => JSON.stringify(value)).join(" | ")
          : "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "json": {
        const properties = schema.properties;
        if (!properties || Object.keys(properties).length === 0) return "unknown";
        return emitObject(properties, requiredKeys(properties, schema.required_keys), indent, depth);
      }
      case "array": {
        // Arrays of objects carry their element shape on `inner_properties`,
        // not `properties` — a detail the SDK's type omits entirely.
        if (schema.inner_val_type === "json") {
          const properties = schema.inner_properties;
          if (!properties || Object.keys(properties).length === 0) return "unknown[]";
          return arrayOf(
            emitObject(
              properties,
              requiredKeys(properties, schema.inner_required_keys),
              indent,
              depth,
            ),
          );
        }
        return arrayOf(emitType({ val_type: schema.inner_val_type ?? "" }, indent, depth + 1));
      }
      default:
        return "unknown";
    }
  })();

  return schema.nullable ? `${base} | null` : base;
}

/** A tool's input parameters as an object type. */
function emitInput(input: ToolInput | null | undefined, indent: string): string {
  const parameters = input?.parameters ?? [];
  if (parameters.length === 0) return "Record<string, never>";

  const inner = indent + INDENT;
  const lines: string[] = ["{"];
  for (const parameter of [...parameters].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(...docComment(parameter.description ?? parameter.value_schema?.description, inner));
    const optional = parameter.required ? "" : "?";
    lines.push(`${inner}${key(parameter.name)}${optional}: ${emitType(parameter.value_schema, inner, 1)};`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

export type CodegenTool = {
  name: string;
  qualifiedName: string;
  fullyQualifiedName: string;
  toolkitName: string;
  description: string | null;
  input: ToolInput | null;
  output: ToolOutput | null;
};

export type GeneratedTypes = {
  /** The `arcade:runtime` declaration file. */
  source: string;
  nameMap: NameMap;
  stats: { toolkits: number; tools: number; typedOutputs: number };
  warnings: string[];
};

/**
 * The parts of `arcade:runtime` that don't depend on the catalog: a Zod-shaped
 * schema builder, the context type and `defineScript`.
 *
 * This is a deliberate subset rather than Zod itself. Zod's declarations are large
 * enough to dominate the cost of type-checking a twenty-line script, and the
 * validator has to convert whatever the author writes into a runtime check
 * anyway — owning the surface keeps both cheap.
 */
const PRELUDE = String.raw`  /** Built by ${"`z`"}; read back out with ${"`Infer`"}. */
interface Schema<T> {
  readonly __out: T;
}

interface Chainable<T> extends Schema<T> {
  /** Allows the value to be absent. Makes the surrounding object key optional. */
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
  describe(text: string): this;
}

interface StringSchema extends Chainable<string> {
  min(length: number): StringSchema;
  max(length: number): StringSchema;
  regex(pattern: RegExp): StringSchema;
  email(): StringSchema;
  url(): StringSchema;
}
interface NumberSchema extends Chainable<number> {
  int(): NumberSchema;
  min(value: number): NumberSchema;
  max(value: number): NumberSchema;
}
interface BooleanSchema extends Chainable<boolean> {}
interface UnknownSchema extends Chainable<unknown> {}
interface ArraySchema<T> extends Chainable<T[]> {
  min(length: number): ArraySchema<T>;
  max(length: number): ArraySchema<T>;
}
interface EnumSchema<V extends string> extends Chainable<V> {}
interface RecordSchema<T> extends Chainable<Record<string, T>> {}
interface ObjectSchema<S extends Record<string, Schema<unknown>>>
  extends Chainable<Expand<ShapeOut<S>>> {
  readonly shape: S;
}

type Infer<S> = S extends Schema<infer T> ? T : never;

type OptionalKeys<S> = {
  [K in keyof S]-?: undefined extends Infer<S[K]> ? K : never;
}[keyof S];
type ShapeOut<S extends Record<string, Schema<unknown>>> = {
  [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>;
} & { [K in OptionalKeys<S>]?: Infer<S[K]> };
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

declare const z: {
  string(): StringSchema;
  number(): NumberSchema;
  /** Shorthand for ${"`z.number().int()`"}. */
  int(): NumberSchema;
  boolean(): BooleanSchema;
  /** An opaque value. Use when a shape genuinely isn't known. */
  unknown(): UnknownSchema;
  object<S extends Record<string, Schema<unknown>>>(shape: S): ObjectSchema<S>;
  array<S extends Schema<unknown>>(element: S): ArraySchema<Infer<S>>;
  enum<const V extends readonly string[]>(values: V): EnumSchema<V[number]>;
  record<S extends Schema<unknown>>(value: S): RecordSchema<Infer<S>>;
  literal<const V extends string | number | boolean>(value: V): Chainable<V>;
};

/** Every tool this snapshot exposes. */
type ToolPath = keyof ToolOutputs;

/** Shapes declared through ${"`expect`"} win over whatever the catalog says. */
type Expected = Partial<Record<ToolPath, Schema<unknown>>>;
type Resolve<P extends ToolPath, E extends Expected> = P extends keyof E
  ? Infer<E[P]>
  : ToolOutputs[P];

/**
 * Second argument to ${"`run`"}. Destructuring it is what grants capability: the
 * toolkits you name are the only ones the sandbox will call, so
 * ${"`async run(input, { github, log })`"} can reach GitHub and nothing else.
 */
type Ctx<E extends Expected = {}> = Toolkits<E> & {
  /** Appended to the run's ${"`logs`"}. */
  log(...values: unknown[]): void;
};

type ScriptConfig<
  I extends Schema<unknown>,
  O extends Schema<unknown>,
  E extends Expected,
> = {
  /** Validated against the caller's ${"`input`"} before ${"`run`"} is entered. */
  input: I;
  /** Validated against the return value before the response is sent. */
  output: O;
  /**
   * Shapes for tools whose output the catalog leaves unspecified. Unlike a
   * catalog shape, an ${"`expect`"} is an assertion by the author, so a mismatch at
   * runtime fails the run.
   */
  expect?: E;
  run(input: Infer<I>, ctx: Ctx<E>): Promise<Infer<O>>;
};

declare function defineScript<
  I extends Schema<unknown>,
  O extends Schema<unknown>,
  const E extends Expected = {},
>(config: ScriptConfig<I, O, E>): ScriptConfig<I, O, E>;
`;

/**
 * Renders the `arcade:runtime` module for a set of tools.
 *
 * `nameMap` should be the map for the **whole** catalog even when `tools` is a
 * subset: collisions resolve against everything present, so deriving names from a
 * filtered list would hand the same tool different identifiers depending on which
 * toolkits a caller asked for. Namespaces with no tools in `tools` are dropped.
 */
export function generateTypes(
  tools: readonly CodegenTool[],
  catalogNameMap?: NameMap,
): GeneratedTypes {
  const nameMap = catalogNameMap ?? buildNameMap(tools);
  const byQualifiedName = new Map(tools.map((tool) => [tool.qualifiedName, tool] as const));

  let typedOutputs = 0;
  let emittedNamespaces = 0;
  const outputs: string[] = [];
  const namespaces: string[] = [];

  const emitMethod = (binding: ToolBinding, tool: CodegenTool): string[] => {
    const lines = docComment(tool.description ?? undefined, INDENT.repeat(3));
    const inputType = emitInput(tool.input, INDENT.repeat(3));
    lines.push(
      `${INDENT.repeat(3)}${binding.method}(input: ${inputType}): Promise<Resolve<"${binding.path}", E>>;`,
    );
    return lines;
  };

  for (const [namespace, entry] of [...nameMap.namespaces].sort(([a], [b]) => a.localeCompare(b))) {
    const methods: string[] = [];

    for (const binding of [...entry.methods.values()].sort((a, b) => a.method.localeCompare(b.method))) {
      const tool = byQualifiedName.get(binding.qualifiedName);
      if (!tool) continue;

      const specified = isSpecified(tool.output?.value_schema);
      if (specified) typedOutputs++;

      outputs.push(...docComment(tool.output?.description ?? undefined, INDENT.repeat(2)));
      if (!specified) {
        outputs.push(
          `${INDENT.repeat(2)}// Output shape unspecified upstream — declare one with \`expect\`.`,
        );
      }
      outputs.push(
        `${INDENT.repeat(2)}${JSON.stringify(binding.path)}: ${emitType(
          tool.output?.value_schema,
          INDENT.repeat(2),
          0,
        )};`,
      );

      methods.push(...emitMethod(binding, tool));
    }

    // A filtered request only asks for some toolkits; the rest contribute nothing.
    if (methods.length === 0) continue;

    emittedNamespaces++;
    namespaces.push(
      `${INDENT.repeat(2)}${key(namespace)}: {`,
      ...methods,
      `${INDENT.repeat(2)}};`,
    );
  }

  // A file with no top-level import or export is a *global* declaration file, so
  // everything below is ambient. That is deliberate: a script then needs no import
  // to reach `z`, `defineScript` or its toolkits, which is what lets the policy
  // pass reject every import outright rather than allow-listing one.
  const header = [
    "// Generated from the mirrored Arcade catalog. Do not edit.",
    `// ${tools.length} tool(s) across ${emittedNamespaces} toolkit(s); ` +
      `${typedOutputs} declare an output shape, ${tools.length - typedOutputs} return \`unknown\`.`,
    "//",
    "// These declarations are ambient — a script imports nothing.",
    ...nameMap.warnings.map((warning) => `// note: ${warning}`),
    "",
  ];

  const source = [
    ...header,
    PRELUDE,
    "/** Declared output shape per tool, or `unknown` where the catalog is silent. */",
    "interface ToolOutputs {",
    ...outputs.map(dedent),
    "}",
    "",
    "type Toolkits<E extends Expected = {}> = {",
    ...namespaces.map(dedent),
    "};",
    "",
  ].join("\n");

  return {
    source,
    nameMap,
    stats: { toolkits: emittedNamespaces, tools: tools.length, typedOutputs },
    warnings: nameMap.warnings,
  };
}
