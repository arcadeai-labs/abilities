/**
 * Builds the run form's starting payload from a script's declared input schema.
 *
 * Authors are asked to put a `default` on each input property when they upsert;
 * those land here first. A root-level `default` wins. Otherwise each property
 * that declares one contributes, and every required property without a default
 * still appears — filled with a type-shaped placeholder — so the textarea always
 * shows a complete, editable payload the user can tweak before hitting run.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A value that satisfies `schema` well enough to seed the run form. */
function placeholderFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return null
  if ("default" in schema) return schema.default
  if ("const" in schema) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }

  switch (schema.type) {
    case "string": {
      if (schema.format === "email") return "user@example.com"
      if (schema.format === "uri" || schema.format === "url") {
        return "https://example.com"
      }
      const min =
        typeof schema.minLength === "number" && schema.minLength > 0
          ? schema.minLength
          : 0
      return min > 0 ? "x".repeat(min) : ""
    }
    case "integer":
    case "number": {
      const min = typeof schema.minimum === "number" ? schema.minimum : 0
      const value =
        typeof schema.maximum === "number" && min > schema.maximum
          ? schema.maximum
          : min
      return schema.type === "integer" ? Math.trunc(value) : value
    }
    case "boolean":
      return false
    case "null":
      return null
    case "array": {
      const min =
        typeof schema.minItems === "number" && schema.minItems > 0
          ? schema.minItems
          : 0
      return Array.from({ length: min }, () =>
        placeholderFromSchema(schema.items)
      )
    }
    case "object":
      return defaultInputFromSchema(schema)
    default:
      return null
  }
}

function defaultInputFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return {}
  if ("default" in schema) return schema.default

  const properties = isRecord(schema.properties) ? schema.properties : null
  if (!properties) return {}

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string"
        )
      : []
  )

  const payload: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(properties)) {
    if (isRecord(property) && "default" in property) {
      payload[name] = property.default
      continue
    }
    if (required.has(name)) {
      payload[name] = placeholderFromSchema(property)
    }
  }
  return payload
}

/** Pretty-printed JSON for the run form's textarea. */
function defaultInputJson(schema: unknown): string {
  return `${JSON.stringify(defaultInputFromSchema(schema), null, 2)}\n`
}

export { defaultInputFromSchema, defaultInputJson }
