/**
 * Builds the run form's starting payload from a script's declared input schema.
 *
 * Authors are asked to put a `default` on each input property when they upsert;
 * this is where those land. A root-level `default` wins; otherwise each property
 * that declares one contributes. Properties without a default are left out — the
 * form should not invent values the author did not offer.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function defaultInputFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return {}
  if ("default" in schema) return schema.default

  const properties = isRecord(schema.properties) ? schema.properties : null
  if (!properties) return {}

  const payload: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(properties)) {
    if (isRecord(property) && "default" in property) {
      payload[name] = property.default
    }
  }
  return payload
}

/** Pretty-printed JSON for the run form's textarea. */
function defaultInputJson(schema: unknown): string {
  return `${JSON.stringify(defaultInputFromSchema(schema), null, 2)}\n`
}

export { defaultInputFromSchema, defaultInputJson }
