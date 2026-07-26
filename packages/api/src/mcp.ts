/**
 * The API, as an MCP server over streamable HTTP.
 *
 * There is no per-tool glue: every operation in the generated OpenAPI document
 * becomes a tool, so a route that exists is a tool that exists and adding an
 * endpoint needs nothing here. The document is the interface — `describeRoute`'s
 * prose is what the model reads, and `operationId` (which hono-openapi derives
 * from the method and path) is the tool name.
 *
 * Two things make that possible cheaply. Tools dispatch **in process** through
 * `app.request`, so the bridge never talks to its own HTTP port and needs no
 * server to be listening. And `/api/mcp` itself carries no `describeRoute`, so it
 * stays out of the document exactly as `/api/openapi` and `/api/scalar` do, and
 * cannot generate a tool for itself.
 *
 * The translation is one transformation, and nothing else: MCP hands a tool a single
 * flat `arguments` object, while an HTTP operation splits its inputs across the path,
 * the query string and a JSON body. {@link plan} flattens the three into one schema
 * and remembers where each argument goes, so {@link rebuild} can put it back.
 *
 * **Every input the document declares is advertised, and nothing else is.** No field
 * is stripped, defaulted or injected — a tool's parameters are exactly its
 * operation's, so what a caller reads in `/api/scalar` is what it passes here. That
 * includes `userId` on the run tool: identity is a parameter like any other until
 * there is auth to derive it from, at which point it moves out of the schema and this
 * comment changes with it.
 */

import { StreamableHTTPTransport } from "@hono/mcp"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { Context } from "hono"

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Methods that can carry a JSON body; the rest put everything in path and query. */
const BODY_METHODS = new Set(["post", "put", "patch"])
const METHODS = new Set(["get", "post", "put", "patch", "delete"])

/**
 * Annotations the document cannot express. OpenAPI has no equivalent of MCP's
 * behavioural hints, so `readOnlyHint` is derived from the method — a GET reads —
 * and anything a method does not imply is stated here. Omitting `destructiveHint`
 * leaves MCP's default of `true`, which is the conservative reading and the right
 * one for `runScript`, whose effect depends entirely on the script.
 */
const ANNOTATIONS: Record<string, Json> = {
  // Executes nothing and stores nothing — the loop an author iterates in.
  postApiValidate: { readOnlyHint: true },
  // Re-paginates the whole upstream catalog and sweeps absent rows. Slow.
  postApiSeed: { destructiveHint: true, idempotentHint: true },
  putApiScriptsByName: { idempotentHint: true },
  deleteApiScriptsByName: { destructiveHint: true, idempotentHint: true },
  // Reaches third-party APIs as the end user.
  postApiScriptsByNameRun: { openWorldHint: true },
}

/**
 * A response big enough to evict the conversation it was fetched for is worse than
 * an error, because it looks like success. `GET /api/types` over the whole catalog
 * is several megabytes, so results are cut here and the tool says how to ask for
 * less.
 */
const RESULT_LIMIT = 64_000

/** Where a flattened argument came from, so a call can put it back. */
type Slot = { in: "path" | "query" | "body"; name: string }

type Tool = {
  name: string
  title?: string
  description?: string
  inputSchema: Json
  annotations: Json
  method: string
  /** `/api/scripts/{name}/run` — parameters still in place. */
  template: string
  slots: Map<string, Slot>
}

/**
 * Flattens one operation's path parameters, query parameters and JSON body
 * properties into a single object schema.
 *
 * Flat rather than nested (`{path: …, query: …, body: …}`) because a model fills a
 * flat object reliably and a nested one badly — but flattening can collide two
 * differently-scoped names into one, which would silently route a value to the
 * wrong place. So a collision throws at startup rather than at call time.
 */
function plan(template: string, method: string, operation: Json): Tool {
  const properties: Json = {}
  const required: string[] = []
  const slots = new Map<string, Slot>()

  const claim = (
    name: string,
    schema: unknown,
    isRequired: boolean,
    slot: Slot
  ) => {
    const existing = slots.get(name)
    if (existing) {
      throw new Error(
        `${method.toUpperCase()} ${template}: \`${name}\` arrives both in the ${existing.in} and in the ${slot.in}. ` +
          "Flattened tool arguments must be unambiguous — rename one of them."
      )
    }
    slots.set(name, slot)
    properties[name] = schema
    if (isRequired) required.push(name)
  }

  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : []
  for (const parameter of parameters) {
    if (!isRecord(parameter)) continue
    const name = parameter.name
    const where = parameter.in
    if (typeof name !== "string") continue
    if (where !== "path" && where !== "query") continue
    claim(name, parameter.schema ?? {}, parameter.required === true, {
      in: where,
      name,
    })
  }

  const body = jsonBody(operation)
  if (body) {
    const bodyProperties = isRecord(body.properties) ? body.properties : {}
    const bodyRequired = Array.isArray(body.required) ? body.required : []
    for (const [name, schema] of Object.entries(bodyProperties)) {
      claim(name, schema, bodyRequired.includes(name), { in: "body", name })
    }
  }

  const summary =
    typeof operation.summary === "string" ? operation.summary : undefined
  const detail =
    typeof operation.description === "string"
      ? operation.description
      : undefined
  const operationId = operation.operationId

  if (typeof operationId !== "string") {
    throw new Error(
      `${method.toUpperCase()} ${template} has no operationId to name a tool with.`
    )
  }

  return {
    name: operationId,
    title: summary,
    description: [summary, detail].filter(Boolean).join("\n\n") || undefined,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    annotations: {
      ...(method === "get" ? { readOnlyHint: true } : {}),
      ...ANNOTATIONS[operationId],
    },
    method,
    template,
    slots,
  }
}

function jsonBody(operation: Json): Json | undefined {
  const requestBody = operation.requestBody
  if (!isRecord(requestBody)) return undefined
  const content = requestBody.content
  if (!isRecord(content)) return undefined
  const json = content["application/json"]
  if (!isRecord(json)) return undefined
  return isRecord(json.schema) ? json.schema : undefined
}

function build(document: Json): Tool[] {
  const paths = isRecord(document.paths) ? document.paths : {}
  const tools: Tool[] = []

  for (const [template, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method) || !isRecord(operation)) continue
      const tool = plan(template, method, operation)

      // `hoistDefs` moves every named schema into `components.schemas`, which an MCP
      // client never sees — so a `$ref` surviving into an input schema would dangle
      // on the far side. Today only responses carry refs; this keeps it that way.
      if (JSON.stringify(tool.inputSchema).includes("$ref")) {
        throw new Error(
          `${method.toUpperCase()} ${template}: input schema contains a $ref, which an MCP client cannot resolve. ` +
            "Inline the schema or teach the bridge to attach $defs."
        )
      }
      tools.push(tool)
    }
  }

  return tools
}

/** Turns flat arguments back into a path, a query string and a body. */
function rebuild(tool: Tool, args: Json) {
  let path = tool.template
  const query = new URLSearchParams()
  const body: Json = {}
  let hasBody = false

  for (const [name, value] of Object.entries(args)) {
    const slot = tool.slots.get(name)
    // Unknown arguments are dropped rather than forwarded: the route's own
    // validator would reject the request, and a clear omission beats a 400.
    if (!slot || value === undefined) continue

    if (slot.in === "path") {
      path = path.replace(`{${slot.name}}`, encodeURIComponent(String(value)))
    } else if (slot.in === "query") {
      // A repeatable parameter arrives as an array; the routes accept either form.
      if (Array.isArray(value))
        for (const item of value) query.append(slot.name, String(item))
      else query.append(slot.name, String(value))
    } else {
      body[slot.name] = value
      hasBody = true
    }
  }

  const search = query.toString()
  const url = search ? `${path}?${search}` : path
  const sendBody = hasBody || BODY_METHODS.has(tool.method)

  return {
    url,
    init: {
      method: tool.method.toUpperCase(),
      ...(sendBody
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  }
}

type Dispatch = (path: string, init?: RequestInit) => Promise<Response>

export type McpOptions = {
  /** In-process dispatch — `app.request`, never a network round trip to ourselves. */
  dispatch: Dispatch
  document: () => Promise<Json>
}

export function createMcpHandler(options: McpOptions) {
  // The route table is fixed at startup and `document()` memoizes, so the tool list
  // is built once. A stored script's tools are a live read; endpoints are not.
  let tools: Promise<Map<string, Tool>> | undefined
  const load = () =>
    (tools ??= options.document().then((document) => {
      const built = build(document)
      return new Map(built.map((tool) => [tool.name, tool]))
    }))

  const server = () => {
    const mcp = new Server(
      { name: "arcade-tools-mirror", version: "1.0.0" },
      { capabilities: { tools: {} } }
    )

    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      const known = await load()
      return {
        tools: [...known.values()].map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
      }
    })

    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const known = await load()
      const tool = known.get(request.params.name)
      // An unknown tool is a protocol error, not a failed call: the client asked for
      // something that was never advertised.
      if (!tool) throw new Error(`Unknown tool: ${request.params.name}`)

      const args = isRecord(request.params.arguments)
        ? request.params.arguments
        : {}
      const { url, init } = rebuild(tool, args)
      const response = await options.dispatch(url, init)
      const text = await response.text()

      const clipped = text.length > RESULT_LIMIT
      const body = clipped
        ? `${text.slice(0, RESULT_LIMIT)}\n\n[truncated ${text.length - RESULT_LIMIT} of ${text.length} bytes — narrow the request, e.g. with \`toolkit\`]`
        : text

      return {
        // A non-2xx is the tool failing, not the server failing: reporting it in the
        // result lets the model read the error and correct the call, where a thrown
        // JSON-RPC error would just say the server is broken. The routes return
        // structured failures (`input_invalid` with violations, `authorization_required`
        // with auth URLs), so the body is the useful part either way.
        isError: !response.ok,
        content: [{ type: "text", text: body }],
        _meta: { status: response.status, url },
      }
    })

    return mcp
  }

  /**
   * Stateless: no session id, so a fresh server and transport per POST and nothing
   * to garbage-collect. Vite re-evaluates this module on every edit, and a
   * module-level transport registry is exactly the hazard that already forced
   * `src/db.ts` onto `globalThis` — this avoids needing the same trick.
   *
   * `enableJsonResponse` returns plain JSON rather than an SSE stream. Nothing here
   * streams: there are no progress notifications and no sampling, and it keeps the
   * response a simple body for the frontend's splat route to hand back. Streaming a
   * run's `logs` as they happen is the reason to revisit this.
   */
  return async (c: Context) => {
    const mcp = server()
    const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
    await mcp.connect(transport)
    try {
      const response = await transport.handleRequest(c)
      // The transport answers every request it accepts; nothing reaches here unless
      // it declined to, which is ours to notice rather than to return as an empty body.
      return (
        response ??
        c.json(
          {
            error: "mcp_no_response",
            message: "The transport produced no response.",
          },
          500
        )
      )
    } finally {
      await mcp.close()
    }
  }
}
