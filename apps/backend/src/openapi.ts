import { generateSpecs } from "hono-openapi";

type SpecTarget = Parameters<typeof generateSpecs>[0];
type SpecOptions = Parameters<typeof generateSpecs>[1];

type Json = Record<string, unknown>;

/**
 * Zod emits named schemas (`.meta({ id })`) into a schema-local `$defs`, while
 * hono-openapi rewrites the references to `#/components/schemas/<id>`. Left
 * alone those refs dangle, because nothing ever populates `components.schemas`.
 *
 * This walks the document, lifts every `$defs` entry up into `components.schemas`,
 * and drops the now-redundant local blocks so each `$ref` resolves.
 */
function hoistDefs(spec: Json): Json {
  const schemas: Json = { ...((spec.components as Json | undefined)?.schemas as Json | undefined) };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;

    const out: Json = {};
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === "$defs" && value && typeof value === "object") {
        for (const [id, def] of Object.entries(value as Json)) {
          // First definition wins; ids are unique per schema so collisions are
          // the same schema reached by two routes.
          schemas[id] ??= walk(def);
        }
        continue; // drop the local $defs block
      }
      out[key] = walk(value);
    }
    return out;
  };

  const walked = walk(spec) as Json;
  return {
    ...walked,
    components: { ...((walked.components as Json | undefined) ?? {}), schemas },
  };
}

/** Generated once per process — the route table is fixed at startup. */
export function openApiDocument(app: SpecTarget, options: SpecOptions) {
  let cached: Promise<Json> | undefined;
  return () => (cached ??= generateSpecs(app, options).then((spec) => hoistDefs(spec as unknown as Json)));
}
