/**
 * Reads a script's `z.…` contract out of its syntax tree, without evaluating it.
 *
 * A script declares `input`, `output` and `expect` as `z` expressions, and those
 * declarations have to become real runtime checks — the type checker can be lied
 * to, so the values crossing in and out of the sandbox get validated for real. The
 * obvious way to get there is to execute the config; interpreting the AST instead
 * keeps the promise that storing a script never runs any of it.
 *
 * The DSL is deliberately small (see the prelude in ./codegen), which is what makes
 * a total interpreter over it tractable: every node is either understood or a
 * diagnostic, never a guess.
 */

import ts from "typescript";
import { requiredKeys, type ToolInput, type ValueSchema } from "./value-schema";

export type Spec =
  | { kind: "string"; min?: number; max?: number; pattern?: string; format?: "email" | "url" }
  | { kind: "number"; int?: boolean; min?: number; max?: number }
  | { kind: "boolean" }
  | { kind: "unknown" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; element: Spec; min?: number; max?: number }
  | { kind: "record"; value: Spec }
  | { kind: "object"; fields: Record<string, { spec: Spec; optional: boolean }> }
  | { kind: "nullable"; inner: Spec };

export class DslError extends Error {
  constructor(
    message: string,
    readonly node: ts.Node,
  ) {
    super(message);
  }
}

const literalValue = (node: ts.Expression): string | number | boolean => {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalValue(node.operand);
    if (typeof inner === "number") return -inner;
  }
  throw new DslError("Only literal values are allowed here.", node);
};

const numberArgument = (node: ts.Expression | undefined, at: ts.Node): number => {
  if (!node) throw new DslError("Expected a number argument.", at);
  const value = literalValue(node);
  if (typeof value !== "number") throw new DslError("Expected a number argument.", node);
  return value;
};

/**
 * Interprets a `z`-rooted expression. Modifier calls (`.optional()`, `.min()`)
 * wrap outward, so the chain is unwound from the outside in.
 */
export function interpretSpec(node: ts.Expression): { spec: Spec; optional: boolean } {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const target = node.expression.expression;

    // `z.foo(...)` — a constructor rather than a modifier.
    if (ts.isIdentifier(target) && target.text === "z") {
      return { spec: construct(method, node), optional: false };
    }

    const inner = interpretSpec(target);
    switch (method) {
      case "optional":
        return { ...inner, optional: true };
      case "nullable":
        return { spec: { kind: "nullable", inner: inner.spec }, optional: inner.optional };
      case "describe":
        return inner;
      case "int":
        if (inner.spec.kind !== "number") throw new DslError("`int()` applies to numbers.", node);
        return { ...inner, spec: { ...inner.spec, int: true } };
      case "min":
      case "max": {
        const value = numberArgument(node.arguments[0], node);
        if (inner.spec.kind === "string" || inner.spec.kind === "number" || inner.spec.kind === "array") {
          return { ...inner, spec: { ...inner.spec, [method]: value } as Spec };
        }
        throw new DslError(`\`${method}()\` does not apply to this schema.`, node);
      }
      case "email":
      case "url":
        if (inner.spec.kind !== "string") throw new DslError(`\`${method}()\` applies to strings.`, node);
        return { ...inner, spec: { ...inner.spec, format: method } };
      case "regex": {
        const argument = node.arguments[0];
        if (!argument || !ts.isRegularExpressionLiteral(argument)) {
          throw new DslError("`regex()` needs a literal regular expression.", node);
        }
        if (inner.spec.kind !== "string") throw new DslError("`regex()` applies to strings.", node);
        const body = argument.text.slice(1, argument.text.lastIndexOf("/"));
        return { ...inner, spec: { ...inner.spec, pattern: body } };
      }
      default:
        throw new DslError(`Unknown schema method \`${method}\`.`, node);
    }
  }

  throw new DslError("Expected a `z.…` schema expression.", node);
}

function construct(method: string, call: ts.CallExpression): Spec {
  const [first] = call.arguments;

  switch (method) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: "number" };
    case "int":
      return { kind: "number", int: true };
    case "boolean":
      return { kind: "boolean" };
    case "unknown":
      return { kind: "unknown" };

    case "literal":
      if (!first) throw new DslError("`z.literal()` needs a value.", call);
      return { kind: "literal", value: literalValue(first) };

    case "enum": {
      if (!first || !ts.isArrayLiteralExpression(first)) {
        throw new DslError("`z.enum()` needs an array literal of strings.", call);
      }
      const values = first.elements.map((element) => {
        const value = literalValue(element);
        if (typeof value !== "string") throw new DslError("`z.enum()` takes strings.", element);
        return value;
      });
      return { kind: "enum", values };
    }

    case "array": {
      if (!first) throw new DslError("`z.array()` needs an element schema.", call);
      const element = interpretSpec(first);
      if (element.optional) throw new DslError("Array elements may not be optional.", first);
      return { kind: "array", element: element.spec };
    }

    case "record": {
      if (!first) throw new DslError("`z.record()` needs a value schema.", call);
      return { kind: "record", value: interpretSpec(first).spec };
    }

    case "object": {
      if (!first || !ts.isObjectLiteralExpression(first)) {
        throw new DslError("`z.object()` needs an object literal.", call);
      }
      const fields: Record<string, { spec: Spec; optional: boolean }> = {};
      for (const property of first.properties) {
        if (!ts.isPropertyAssignment(property)) {
          throw new DslError("Shape entries must be `key: z.…` assignments.", property);
        }
        const name = ts.isIdentifier(property.name)
          ? property.name.text
          : ts.isStringLiteralLike(property.name)
            ? property.name.text
            : null;
        if (name === null) throw new DslError("Shape keys must be plain names.", property.name);
        fields[name] = interpretSpec(property.initializer);
      }
      return { kind: "object", fields };
    }

    default:
      throw new DslError(`Unknown schema constructor \`z.${method}\`.`, call);
  }
}

// ── catalog schemas as specs ───────────────────────────────────────────────

/**
 * Converts an Arcade `ValueSchema` into the same {@link Spec} the DSL produces, so
 * one validator covers both a script's declared contract and the catalog's own
 * shapes. Used to check tool arguments on the way out and results on the way back.
 */
export function specFromValueSchema(schema: ValueSchema | undefined): Spec {
  if (!schema) return { kind: "unknown" };

  const base = ((): Spec => {
    switch (schema.val_type) {
      case "string":
        return schema.enum?.length ? { kind: "enum", values: schema.enum } : { kind: "string" };
      case "integer":
        return { kind: "number", int: true };
      case "number":
        return { kind: "number" };
      case "boolean":
        return { kind: "boolean" };
      case "json":
        return schema.properties && Object.keys(schema.properties).length > 0
          ? objectSpec(schema.properties, requiredKeys(schema.properties, schema.required_keys))
          : { kind: "unknown" };
      case "array": {
        if (schema.inner_val_type === "json") {
          const properties = schema.inner_properties;
          return {
            kind: "array",
            element:
              properties && Object.keys(properties).length > 0
                ? objectSpec(properties, requiredKeys(properties, schema.inner_required_keys))
                : { kind: "unknown" },
          };
        }
        return { kind: "array", element: specFromValueSchema({ val_type: schema.inner_val_type ?? "" }) };
      }
      default:
        return { kind: "unknown" };
    }
  })();

  return schema.nullable ? { kind: "nullable", inner: base } : base;
}

const objectSpec = (properties: Record<string, ValueSchema>, required: Set<string>): Spec => ({
  kind: "object",
  fields: Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      { spec: specFromValueSchema(value), optional: !required.has(name) },
    ]),
  ),
});

/** A tool's declared parameters as an object spec. */
export function specFromToolInput(input: ToolInput | null | undefined): Spec {
  const parameters = input?.parameters ?? [];
  return {
    kind: "object",
    fields: Object.fromEntries(
      parameters.map((parameter) => [
        parameter.name,
        { spec: specFromValueSchema(parameter.value_schema), optional: !parameter.required },
      ]),
    ),
  };
}

// ── runtime validation ─────────────────────────────────────────────────────

export type Violation = { path: string; message: string };

const typeName = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** Checks a value against a spec, collecting every violation rather than the first. */
export function validateSpec(spec: Spec, value: unknown, path = ""): Violation[] {
  const fail = (message: string): Violation[] => [{ path: path || "(root)", message }];

  switch (spec.kind) {
    case "unknown":
      return [];

    case "nullable":
      return value === null ? [] : validateSpec(spec.inner, value, path);

    case "string": {
      if (typeof value !== "string") return fail(`expected string, got ${typeName(value)}`);
      if (spec.min !== undefined && value.length < spec.min) return fail(`shorter than ${spec.min}`);
      if (spec.max !== undefined && value.length > spec.max) return fail(`longer than ${spec.max}`);
      if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
        return fail(`does not match /${spec.pattern}/`);
      }
      if (spec.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return fail("not an email address");
      }
      if (spec.format === "url") {
        try {
          new URL(value);
        } catch {
          return fail("not a URL");
        }
      }
      return [];
    }

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(`expected number, got ${typeName(value)}`);
      }
      if (spec.int && !Number.isInteger(value)) return fail("expected an integer");
      if (spec.min !== undefined && value < spec.min) return fail(`below ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) return fail(`above ${spec.max}`);
      return [];
    }

    case "boolean":
      return typeof value === "boolean" ? [] : fail(`expected boolean, got ${typeName(value)}`);

    case "literal":
      return value === spec.value ? [] : fail(`expected ${JSON.stringify(spec.value)}`);

    case "enum":
      return typeof value === "string" && spec.values.includes(value)
        ? []
        : fail(`expected one of ${spec.values.map((v) => JSON.stringify(v)).join(", ")}`);

    case "array": {
      if (!Array.isArray(value)) return fail(`expected array, got ${typeName(value)}`);
      if (spec.min !== undefined && value.length < spec.min) return fail(`fewer than ${spec.min} items`);
      if (spec.max !== undefined && value.length > spec.max) return fail(`more than ${spec.max} items`);
      return value.flatMap((item, index) => validateSpec(spec.element, item, `${path}[${index}]`));
    }

    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fail(`expected object, got ${typeName(value)}`);
      }
      return Object.entries(value).flatMap(([entryKey, entryValue]) =>
        validateSpec(spec.value, entryValue, path ? `${path}.${entryKey}` : entryKey),
      );
    }

    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fail(`expected object, got ${typeName(value)}`);
      }
      const record = value as Record<string, unknown>;
      const violations: Violation[] = [];
      for (const [name, field] of Object.entries(spec.fields)) {
        const child = path ? `${path}.${name}` : name;
        if (!(name in record) || record[name] === undefined) {
          if (!field.optional) violations.push({ path: child, message: "required but missing" });
          continue;
        }
        violations.push(...validateSpec(field.spec, record[name], child));
      }
      return violations;
    }
  }
}
