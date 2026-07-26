/**
 * The shape language a script's contract is expressed in, and the checks over it.
 *
 * `Spec` is the one intermediate form. A script's `input`/`output`/`expect` arrive
 * as JSON Schema and convert into it (./json-schema); the catalog's own
 * `ValueSchema` converts into it too. One validator then covers both, so the
 * argument leaving the sandbox and the result coming back are checked by the same
 * code as the script's declared contract.
 *
 * These checks are the ones that actually hold at runtime. The type checker can be
 * lied to and a stored row can drift, so nothing crossing the sandbox boundary is
 * trusted on the strength of having type-checked earlier.
 */

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
