/**
 * Arcade's schema format, as the API actually sends it.
 *
 * `@arcadeai/arcadejs`'s own `ValueSchema` declares only `val_type`, `enum` and
 * `inner_val_type`, which is a strict subset of the wire format: nested object
 * shapes arrive as `properties`/`required_keys`, arrays of objects as
 * `inner_properties`/`inner_required_keys`, and fields carry `nullable` and
 * `description`. Typing against the SDK makes the fields codegen depends on look
 * like they don't exist, so this package declares the format itself.
 *
 * Shapes below were confirmed against `GET /v1/tools` over 1,331 tools spanning
 * every toolkit family; nesting was observed five levels deep.
 */

/** Every `val_type` seen upstream. Left open — an unrecognised type degrades to `unknown`. */
export type ValType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "json"
  | "array"

export type ValueSchema = {
  /** Compare against {@link ValType}, but treat unknown values as opaque rather than invalid. */
  val_type: string
  /** Always a string list upstream, even for numeric-looking values. */
  enum?: string[]
  nullable?: boolean
  description?: string

  /** Object shape, when `val_type` is `"json"`. Absent means "unspecified", not "empty". */
  properties?: Record<string, ValueSchema>
  /**
   * Which of `properties` are guaranteed present. An empty list alongside a
   * non-empty `properties` is under-specification upstream rather than a claim
   * that nothing is required — see {@link requiredKeys}.
   */
  required_keys?: string[]

  /** Element type, when `val_type` is `"array"`. */
  inner_val_type?: string
  /** Element object shape, when `inner_val_type` is `"json"`. */
  inner_properties?: Record<string, ValueSchema>
  inner_required_keys?: string[]
}

/** One entry of a tool's `input.parameters`. */
export type ToolParameter = {
  name: string
  value_schema: ValueSchema
  description?: string
  required?: boolean
  inferrable?: boolean
}

export type ToolInput = { parameters?: ToolParameter[] }

export type ToolOutput = {
  available_modes?: string[]
  description?: string
  value_schema?: ValueSchema
}

/**
 * Whether a schema says anything about its own shape. `{ val_type: "json" }` with
 * no `properties` is the catalog-wide default and carries no information — those
 * become `unknown` in generated types, which is the whole reason coverage matters.
 */
export function isSpecified(schema: ValueSchema | undefined): boolean {
  if (!schema) return false
  if (schema.val_type === "json")
    return Object.keys(schema.properties ?? {}).length > 0
  if (schema.val_type === "array") {
    return (
      schema.inner_val_type !== "json" ||
      Object.keys(schema.inner_properties ?? {}).length > 0
    )
  }
  return true
}

/** True when a tool declares a usable output shape. */
export const hasTypedOutput = (
  output: ToolOutput | null | undefined
): boolean => isSpecified(output?.value_schema)

/**
 * Resolves which keys of an object schema are required.
 *
 * Upstream sends `required_keys: []` next to a populated `properties` map on some
 * toolkits (`Github.AssignPullRequestUser`'s nested `assigned_user`, for one) while
 * others list every key. An empty list is therefore ambiguous between "all
 * optional" and "nobody filled this in", and the sound reading is that
 * requiredness is unknown — so every property becomes optional and callers are
 * forced through a null check rather than being promised a field that may be
 * absent.
 */
export function requiredKeys(
  properties: Record<string, ValueSchema>,
  declared: string[] | undefined
): Set<string> {
  if (declared === undefined) return new Set()
  const known = declared.filter((k) => k in properties)
  // Nothing declared but properties present → treat requiredness as unspecified.
  return new Set(known)
}
