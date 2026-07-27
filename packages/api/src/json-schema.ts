/**
 * JSON Schema in, {@link Spec} out — and `z.…` source back out for the wrapper.
 *
 * A script's contract arrives as JSON rather than as code, so this is the only
 * place the two representations meet. The subset is deliberately the same shape
 * the DSL already supports: anything richer would type-check against a `z` that
 * cannot express it.
 *
 * The submitted schema is stored verbatim, so reading a script back never runs
 * this in reverse — what you `PUT` is what you `GET`.
 */

import { isRecord, type Spec } from "./schema-dsl"

export type JsonSchema = {
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "object"
    | "array"
    | "null"
  enum?: string[]
  const?: string | number | boolean
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  format?: string
  pattern?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  nullable?: boolean
  description?: string
}

export class JsonSchemaError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(message)
  }
}

const child = (path: string, key: string) => (path ? `${path}.${key}` : key)

/**
 * Converts a JSON Schema to the IR the runtime validator already speaks.
 *
 * Accepts `unknown` because the schema arrives over HTTP: everything is narrowed
 * here, and anything unusable becomes a {@link JsonSchemaError} the caller turns
 * into a contract diagnostic.
 */
export function specFromJsonSchema(schema: unknown, path = ""): Spec {
  if (schema === undefined || schema === null) {
    throw new JsonSchemaError("A schema is required here.", path || "(root)")
  }
  if (!isRecord(schema)) {
    throw new JsonSchemaError("A schema must be an object.", path || "(root)")
  }

  const base = ((): Spec => {
    if (schema.const !== undefined) {
      const constValue = schema.const
      if (
        typeof constValue !== "string" &&
        typeof constValue !== "number" &&
        typeof constValue !== "boolean"
      ) {
        throw new JsonSchemaError(
          "`const` must be a string, number or boolean.",
          path || "(root)"
        )
      }
      return { kind: "literal", value: constValue }
    }
    if (schema.enum) {
      const values = schema.enum
      if (
        !Array.isArray(values) ||
        !values.every((v): v is string => typeof v === "string")
      ) {
        throw new JsonSchemaError(
          "`enum` must be a list of strings.",
          path || "(root)"
        )
      }
      return { kind: "enum", values }
    }

    switch (schema.type) {
      case undefined:
        // No `type` and no `enum` says nothing about the value, which is exactly
        // what `unknown` means. Callers then have to narrow it.
        return { kind: "unknown" }
      case "string":
        return {
          kind: "string",
          ...(typeof schema.minLength === "number"
            ? { min: schema.minLength }
            : {}),
          ...(typeof schema.maxLength === "number"
            ? { max: schema.maxLength }
            : {}),
          ...(typeof schema.pattern === "string"
            ? { pattern: schema.pattern }
            : {}),
          ...(schema.format === "email" ||
          schema.format === "uri" ||
          schema.format === "url"
            ? {
                format:
                  schema.format === "email"
                    ? ("email" as const)
                    : ("url" as const),
              }
            : {}),
        }
      case "integer":
      case "number":
        return {
          kind: "number",
          ...(schema.type === "integer" ? { int: true } : {}),
          ...(typeof schema.minimum === "number"
            ? { min: schema.minimum }
            : {}),
          ...(typeof schema.maximum === "number"
            ? { max: schema.maximum }
            : {}),
        }
      case "boolean":
        return { kind: "boolean" }
      case "null":
        return { kind: "nullable", inner: { kind: "unknown" } }

      case "array": {
        if (!schema.items)
          throw new JsonSchemaError("`array` needs `items`.", path || "(root)")
        return {
          kind: "array",
          element: specFromJsonSchema(schema.items, child(path, "items")),
          ...(typeof schema.minItems === "number"
            ? { min: schema.minItems }
            : {}),
          ...(typeof schema.maxItems === "number"
            ? { max: schema.maxItems }
            : {}),
        }
      }

      case "object": {
        // An object with no `properties` but an `additionalProperties` schema is a
        // map; with neither it is opaque.
        if (!schema.properties) {
          if (
            schema.additionalProperties &&
            typeof schema.additionalProperties === "object"
          ) {
            return {
              kind: "record",
              value: specFromJsonSchema(
                schema.additionalProperties,
                child(path, "additionalProperties")
              ),
            }
          }
          return { kind: "unknown" }
        }
        const properties = isRecord(schema.properties) ? schema.properties : {}
        const required = new Set(
          Array.isArray(schema.required) ? schema.required : []
        )
        return {
          kind: "object",
          fields: Object.fromEntries(
            Object.entries(properties).map(([name, value]) => [
              name,
              {
                spec: specFromJsonSchema(value, child(path, name)),
                optional: !required.has(name),
              },
            ])
          ),
        }
      }

      default:
        throw new JsonSchemaError(
          `Unsupported \`type\`: ${String(schema.type)}.`,
          path || "(root)"
        )
    }
  })()

  return schema.nullable ? { kind: "nullable", inner: base } : base
}

const chain = (base: string, ...calls: (string | false | undefined)[]) =>
  base + calls.filter(Boolean).join("")

/**
 * Renders a {@link Spec} as the `z.…` expression the generated wrapper contains.
 *
 * This exists so the type checker sees the author's declared contract as ordinary
 * source — the same `defineScript` shape a hand-written module would use — which
 * keeps one validation path rather than two.
 */
export function specToSource(spec: Spec): string {
  switch (spec.kind) {
    case "unknown":
      return "z.unknown()"
    case "boolean":
      return "z.boolean()"
    case "literal":
      return `z.literal(${JSON.stringify(spec.value)})`
    case "enum":
      return `z.enum([${spec.values.map((v) => JSON.stringify(v)).join(", ")}])`
    case "nullable":
      return `${specToSource(spec.inner)}.nullable()`

    case "string":
      return chain(
        "z.string()",
        spec.min !== undefined && `.min(${spec.min})`,
        spec.max !== undefined && `.max(${spec.max})`,
        spec.pattern !== undefined &&
          `.regex(/${spec.pattern.replace(/\//g, "\\/")}/)`,
        spec.format === "email" && ".email()",
        spec.format === "url" && ".url()"
      )

    case "number":
      return chain(
        "z.number()",
        spec.int && ".int()",
        spec.min !== undefined && `.min(${spec.min})`,
        spec.max !== undefined && `.max(${spec.max})`
      )

    case "array":
      return chain(
        `z.array(${specToSource(spec.element)})`,
        spec.min !== undefined && `.min(${spec.min})`,
        spec.max !== undefined && `.max(${spec.max})`
      )

    case "record":
      return `z.record(${specToSource(spec.value)})`

    case "object": {
      const entries = Object.entries(spec.fields).map(
        ([name, field]) =>
          `${JSON.stringify(name)}: ${specToSource(field.spec)}${field.optional ? ".optional()" : ""}`
      )
      return entries.length === 0
        ? "z.object({})"
        : `z.object({ ${entries.join(", ")} })`
    }
  }
}
