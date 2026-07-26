import { generateSpecs } from "hono-openapi"

type SpecTarget = Parameters<typeof generateSpecs>[0]
type SpecOptions = Parameters<typeof generateSpecs>[1]

type Json = Record<string, unknown>

const isJson = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Zod emits named schemas (`.meta({ id })`) into a schema-local `$defs`, while
 * hono-openapi rewrites the references to `#/components/schemas/<id>`. Left
 * alone those refs dangle, because nothing ever populates `components.schemas`.
 *
 * This walks the document, lifts every `$defs` entry up into `components.schemas`,
 * and drops the now-redundant local blocks so each `$ref` resolves.
 */
function hoistDefs(spec: unknown): Json {
  const root = isJson(spec) ? spec : {}
  const existing = isJson(root.components) ? root.components.schemas : undefined
  const schemas: Json = { ...(isJson(existing) ? existing : {}) }

  const walkJson = (node: Json): Json => {
    const out: Json = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === "$defs" && isJson(value)) {
        for (const [id, def] of Object.entries(value)) {
          // First definition wins; ids are unique per schema so collisions are
          // the same schema reached by two routes.
          schemas[id] ??= walk(def)
        }
        continue // drop the local $defs block
      }
      out[key] = walk(value)
    }
    return out
  }

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isJson(node)) return node
    return walkJson(node)
  }

  const walked = walkJson(root)
  return {
    ...walked,
    components: {
      ...(isJson(walked.components) ? walked.components : {}),
      schemas,
    },
  }
}

/** Generated once per process — the route table is fixed at startup. */
export function openApiDocument(app: SpecTarget, options: SpecOptions) {
  let cached: Promise<Json> | undefined
  return () =>
    (cached ??= generateSpecs(app, options).then((spec) => hoistDefs(spec)))
}
