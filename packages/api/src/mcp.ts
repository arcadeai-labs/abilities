import { StreamableHTTPTransport } from "@hono/mcp"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type { Context } from "hono"

/**
 * The MCP server is derived, not written: every operation in the OpenAPI document
 * becomes one tool, and adding a route adds a tool with no edit here.
 *
 * That is possible because the document already carries everything a tool needs —
 * a name (`operationId`), prose (`summary`/`description`), an input shape (path
 * parameters, query parameters and the JSON body) and an output shape (the 2xx
 * response). It is generated from the same Zod schemas the routes validate with,
 * so the tool a client sees and the request the route accepts cannot drift apart.
 *
 * Deriving them is what closes the two failures a hand-written adapter had here:
 * descriptions were *copies* of the ones in `describeRoute` and drifted from them,
 * and deleting a route left behind a tool whose only behaviour was to 404. Neither
 * is reachable now — there is one description and no tool without an operation.
 * The cost is that route prose is read by agents, so keep it transport-neutral.
 *
 * This uses the SDK's low-level `Server` rather than `McpServer.registerTool`,
 * which only takes Zod. JSON Schema is MCP's wire format, so handing the
 * document's schemas straight through is both simpler and lossless.
 */

type Json = Record<string, unknown>

/** The shape MCP requires of `inputSchema` and `outputSchema`. */
type ObjectSchema = Tool["inputSchema"]

type RequestFn = (
  path: string,
  init?: RequestInit
) => Response | Promise<Response>

const isJson = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const jsonOf = (value: unknown): Json => (isJson(value) ? value : {})

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter((v) => typeof v === "string")

const schemaMap = (value: unknown): Record<string, Json> => {
  const out: Record<string, Json> = {}
  for (const [key, schema] of Object.entries(jsonOf(value)))
    if (isJson(schema)) out[key] = schema
  return out
}

/** Methods that can carry an operation; `parameters` and `$ref` also live here. */
const METHODS = ["get", "post", "put", "patch", "delete"]

const COMPONENT = "#/components/schemas/"

/**
 * `getScriptTypes` → `get_script_types`. Operation ids are camelCase by OpenAPI
 * convention and MCP tool names are snake_case by MCP's, so the routes stay
 * idiomatic and the translation lives here.
 */
const snake = (id: string) =>
  id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()

/**
 * Inline a top-level `$ref`. MCP requires a literal `type: "object"`, which a bare
 * reference does not have; nested references are fine and become `$defs`.
 */
const deref = (schema: Json, components: Json): Json => {
  const ref = stringOf(schema.$ref)
  return ref?.startsWith(COMPONENT)
    ? jsonOf(components[ref.slice(COMPONENT.length)])
    : schema
}

/**
 * Point every `#/components/schemas/X` at `#/$defs/X` and carry the definitions it
 * reaches along with the schema. A tool schema travels alone — there is no
 * surrounding document for a component reference to resolve against.
 */
function withDefs(schema: Json, components: Json): Json {
  const used = new Set<string>()

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isJson(node)) return node
    const out: Json = {}
    for (const [key, value] of Object.entries(node)) {
      const ref = key === "$ref" ? stringOf(value) : undefined
      if (ref?.startsWith(COMPONENT)) {
        const id = ref.slice(COMPONENT.length)
        used.add(id)
        out.$ref = `#/$defs/${id}`
        continue
      }
      out[key] = walk(value)
    }
    return out
  }

  const walked = jsonOf(walk(schema))
  const defs: Json = {}
  // Walking a definition can reach further definitions, so repeat until it doesn't.
  for (
    let pending = [...used];
    pending.length > 0;
    pending = [...used].filter((id) => !(id in defs))
  )
    for (const id of pending) defs[id] = walk(components[id])

  return Object.keys(defs).length > 0 ? { ...walked, $defs: defs } : walked
}

const objectSchema = (schema: Json, components: Json): ObjectSchema => {
  const {
    type: _type,
    properties,
    required,
    ...rest
  } = withDefs(deref(schema, components), components)
  return {
    ...rest,
    type: "object",
    properties: schemaMap(properties),
    required: strings(required),
  }
}

const jsonBody = (content: unknown): Json =>
  jsonOf(jsonOf(jsonOf(content)["application/json"]).schema)

/**
 * The lowest 2xx JSON response is the tool's declared result. Anything else — a
 * `text/plain` body, or a route whose only success is a redirect — leaves the tool
 * without an output schema, which is allowed and just means untyped content.
 */
function successSchema(responses: Json, components: Json): Json | undefined {
  const status = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0]
  if (status === undefined) return undefined
  const schema = deref(jsonBody(jsonOf(responses[status]).content), components)
  return schema.type === "object" ? schema : undefined
}

/**
 * JSON 2xx responses become `structuredContent` so clients get typed results;
 * anything 4xx/5xx becomes an `isError` result carrying the response body, which
 * the SDK exempts from output-schema validation.
 *
 * A 401 with `WWW-Authenticate` (or an `authorizationUrl` in the JSON body) is
 * shaped for MCP auth recovery: agents see the URL in `content`, and clients that
 * understand SEP-1489 get `mcp/www_authenticate` in `_meta`.
 */
async function toResult(response: Response): Promise<CallToolResult> {
  const text = await response.text()
  const wwwAuthenticate = response.headers.get("www-authenticate")
  let bodyText = text
  if (!response.ok && response.headers.get("content-type")?.includes("json")) {
    try {
      const body = JSON.parse(text) as {
        message?: string
        authorizationUrl?: string
      }
      if (typeof body.authorizationUrl === "string") {
        bodyText = [
          body.message ?? "Authorization required.",
          "",
          "Open this URL to authorize, then retry this tool call:",
          body.authorizationUrl,
        ].join("\n")
      }
    } catch {
      // Keep the raw body when it is not JSON we recognize.
    }
  }
  const content = [{ type: "text" as const, text: bodyText }]
  if (!response.ok) {
    return {
      content,
      isError: true,
      ...(wwwAuthenticate
        ? { _meta: { "mcp/www_authenticate": [wwwAuthenticate] } }
        : {}),
    }
  }
  const parsed = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? JSON.parse(text)
    : undefined
  return isJson(parsed) ? { content, structuredContent: parsed } : { content }
}

type Entry = { tool: Tool; call: (args: Json) => Promise<CallToolResult> }

/**
 * One operation, turned into a tool and the call that serves it. Arguments are a
 * single flat object, split back out by where the document says each one belongs:
 * path parameters into the URL, query parameters into the query string, everything
 * left over into the JSON body. A path or query parameter wins a name collision,
 * since dropping one of those would change which resource is addressed.
 */
function toEntry(
  method: string,
  template: string,
  operation: Json,
  components: Json,
  request: RequestFn
): Entry {
  const parameters = (
    Array.isArray(operation.parameters) ? operation.parameters : []
  ).map(jsonOf)
  const named = (where: string) =>
    parameters
      .filter((p) => p.in === where)
      .map((p) => stringOf(p.name))
      .filter((name) => name !== undefined)

  const inPath = named("path")
  const inQuery = named("query")
  const hasBody = isJson(operation.requestBody)
  const body = deref(
    jsonBody(jsonOf(operation.requestBody).content),
    components
  )

  const properties: Json = { ...schemaMap(body.properties) }
  const required = new Set(strings(body.required))
  for (const parameter of parameters) {
    const name = stringOf(parameter.name)
    if (name === undefined) continue
    // A parameter's prose sits beside its schema in OpenAPI; JSON Schema is all a
    // tool argument gets, so fold the two together.
    const description = stringOf(parameter.description)
    properties[name] = {
      ...jsonOf(parameter.schema),
      ...(description === undefined ? {} : { description }),
    }
    if (parameter.in === "path" || parameter.required === true)
      required.add(name)
  }

  const output = successSchema(jsonOf(operation.responses), components)
  const summary = stringOf(operation.summary)
  const description = stringOf(operation.description)

  const tool: Tool = {
    name: snake(stringOf(operation.operationId) ?? `${method}${template}`),
    ...(summary === undefined ? {} : { title: summary }),
    description: [summary, description].filter(Boolean).join("\n\n"),
    inputSchema: objectSchema(
      { type: "object", properties, required: [...required] },
      components
    ),
    ...(output === undefined
      ? {}
      : { outputSchema: objectSchema(output, components) }),
    // GET is the only method here that cannot change anything, which is exactly
    // what the hint means.
    ...(method === "get" ? { annotations: { readOnlyHint: true } } : {}),
  }

  const call = async (args: Json) => {
    const path = template.replace(/\{([^}]+)\}/g, (_, key) =>
      encodeURIComponent(String(args[key] ?? ""))
    )
    const search = new URLSearchParams()
    for (const name of inQuery) {
      const value = args[name]
      if (value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value])
        search.append(name, String(item))
    }
    const rest: Json = {}
    for (const [key, value] of Object.entries(args))
      if (!inPath.includes(key) && !inQuery.includes(key)) rest[key] = value

    const query = search.toString()
    return toResult(
      await request(
        query ? `${path}?${query}` : path,
        hasBody
          ? {
              method: method.toUpperCase(),
              headers: { "content-type": "application/json" },
              body: JSON.stringify(rest),
            }
          : { method: method.toUpperCase() }
      )
    )
  }

  return { tool, call }
}

/** Every operation in the document, keyed by tool name. */
export function toolsFrom(document: Json, request: RequestFn) {
  const components = jsonOf(jsonOf(document.components).schemas)
  const entries = new Map<string, Entry>()
  for (const [template, item] of Object.entries(jsonOf(document.paths)))
    for (const [method, operation] of Object.entries(jsonOf(item))) {
      if (!METHODS.includes(method) || !isJson(operation)) continue
      const entry = toEntry(method, template, operation, components, request)
      entries.set(entry.tool.name, entry)
    }
  return entries
}

function createServer(document: Json, entries: Map<string, Entry>) {
  const info = jsonOf(document.info)
  const server = new Server(
    {
      name: stringOf(info.title) ?? "api",
      version: stringOf(info.version) ?? "0.0.0",
    },
    {
      capabilities: { tools: {} },
      ...(stringOf(info.description) === undefined
        ? {}
        : { instructions: stringOf(info.description) }),
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...entries.values()].map((entry) => entry.tool),
  }))

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const entry = entries.get(request.params.name)
    if (!entry)
      return Promise.resolve({
        content: [{ type: "text" as const, text: "No such tool." }],
        isError: true,
      })
    return entry.call(jsonOf(request.params.arguments))
  })

  return server
}

/**
 * Stateless streamable-HTTP handler: a fresh server and transport per request, so
 * concurrent clients never share a session and there is nothing to clean up. The
 * tool table is built once — it is a pure function of the document, which is fixed
 * at startup.
 */
export function mcpHandler(options: {
  document: () => Promise<Json>
  request: RequestFn
}) {
  let built:
    | Promise<{ document: Json; entries: Map<string, Entry> }>
    | undefined

  return async (c: Context) => {
    built ??= options.document().then((spec) => ({
      document: spec,
      entries: toolsFrom(spec, options.request),
    }))
    const { document, entries } = await built

    const transport = new StreamableHTTPTransport()
    await createServer(document, entries).connect(transport)
    return transport.handleRequest(c)
  }
}
