/**
 * What the MCP bridge must hold.
 *
 * These are the properties that make "every endpoint is a tool" true and safe, and
 * each one is something that would regress silently. The bridge is what is under
 * test, not the routes behind it — `execute.test.ts` and `sandbox.test.ts` already
 * cover what a run does — so the tool calls here are the ones that need no Arcade
 * key and no catalog.
 */

import { describe, expect, it } from "vitest"
import { z } from "zod"
import app from "./app"

/**
 * The wire shapes, parsed rather than asserted — which keeps this file free of type
 * assertions and makes a malformed envelope a loud failure instead of a confusing
 * one further down.
 */
const ToolShape = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.looseObject({
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
  annotations: z.record(z.string(), z.unknown()).optional(),
})

const ListReply = z.object({ result: z.object({ tools: z.array(ToolShape) }) })

const CallReply = z.object({
  result: z.object({
    isError: z.boolean(),
    content: z.array(z.object({ type: z.string(), text: z.string() })),
    _meta: z.object({ status: z.number(), url: z.string() }),
  }),
})

const InitReply = z.object({
  result: z.object({ capabilities: z.record(z.string(), z.unknown()) }),
})

/**
 * A JSON-RPC failure carries `error` and no `result`. `result` is declared so a
 * reply carrying both would fail here rather than pass quietly — `.optional()`
 * allows the key to be absent, which is the case being described.
 */
const ErrorReply = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
  result: z.undefined().optional(),
})

const OpenApiDoc = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
})

/** Just enough of an operation to state what its declared inputs are. */
const Operation = z.object({
  operationId: z.string(),
  parameters: z.array(z.object({ name: z.string() })).default([]),
  requestBody: z
    .object({
      content: z.record(
        z.string(),
        z.object({
          schema: z.looseObject({
            properties: z.record(z.string(), z.unknown()).optional(),
          }),
        })
      ),
    })
    .optional(),
})

let id = 0

async function post(method: string, params?: unknown) {
  const response = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  })
  return { status: response.status, json: await response.json() }
}

const listTools = async () =>
  ListReply.parse((await post("tools/list")).json).result.tools

async function findTool(name: string) {
  const tool = (await listTools()).find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`no tool named ${name}`)
  return tool
}

async function callTool(name: string, args: unknown) {
  const { status, json } = await post("tools/call", { name, arguments: args })
  return { httpStatus: status, ...CallReply.parse(json).result }
}

/** Every documented operation, straight from the document the bridge reads. */
async function documentedOperations() {
  const document = OpenApiDoc.parse(
    await (await app.request("/api/openapi")).json()
  )
  const methods = new Set(["get", "post", "put", "patch", "delete"])
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => methods.has(method))
      .map((method) => `${method} ${path}`)
  )
}

describe("the handshake", () => {
  it("initializes, and does so on a server that no later request shares", async () => {
    const { status, json } = await post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })

    expect(status).toBe(200)
    expect(InitReply.parse(json).result.capabilities).toHaveProperty("tools")

    // Stateless: this is a different `Server` instance than the one above, and it
    // still answers. That is the property that makes per-request construction safe.
    expect((await listTools()).length).toBeGreaterThan(0)
  })
})

describe("every endpoint is a tool", () => {
  it("exposes exactly one tool per documented operation", async () => {
    const operations = await documentedOperations()
    const tools = await listTools()

    // The count is the invariant: a route added without a tool, or a tool invented
    // without a route, breaks the claim the endpoint makes.
    expect(tools).toHaveLength(operations.length)
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length)
  })

  it("does not expose the MCP endpoint itself", async () => {
    // `/api/mcp` carries no `describeRoute`, so it is absent from the document and
    // cannot become a tool. A bridge that could call itself would recurse.
    const operations = await documentedOperations()
    expect(operations.some((operation) => operation.includes("/api/mcp"))).toBe(
      false
    )
  })

  it("carries the route's prose as the tool description", async () => {
    const tool = await findTool("postApiValidate")
    expect(tool.description).toContain("Checks a script against the catalog")
  })
})

describe("flattening", () => {
  it("merges a path parameter and a body into one schema", async () => {
    const tool = await findTool("putApiScriptsByName")
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "input", "output", "run"])
    )
    // `name` is a path parameter and required there; `run` is required in the body.
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "run"])
    )
  })

  it("routes flattened arguments back to the path and the query string", async () => {
    const result = await callTool("getApiTools", {
      toolkit: ["Math"],
      limit: 2,
    })

    // The reconstructed URL is the assertion: a flat object went in, a path plus a
    // repeated query parameter came out.
    expect(result._meta.url).toBe("/api/tools?toolkit=Math&limit=2")
    expect(result.isError).toBe(false)
  })

  it("reports a failing route as a tool error, not a protocol error", async () => {
    const result = await callTool("getApiScriptsByName", {
      name: "definitely-not-a-script",
    })

    // 404 from the route, but a well-formed JSON-RPC *result* — the model has to be
    // able to read the failure and correct itself. CallReply.parse would have thrown
    // if this had come back as a JSON-RPC error instead.
    expect(result.httpStatus).toBe(200)
    expect(result.isError).toBe(true)
    expect(result._meta.status).toBe(404)
    expect(result.content[0]?.text).toContain("not_found")
  })
})

describe("verbatim", () => {
  it("advertises exactly the inputs the document declares, for every tool", async () => {
    const document = OpenApiDoc.parse(
      await (await app.request("/api/openapi")).json()
    )
    const tools = await listTools()
    const methods = new Set(["get", "post", "put", "patch", "delete"])

    // The whole claim, checked over the whole surface rather than sampled: for each
    // operation, the tool's properties are the union of its parameters and its body's
    // properties — nothing added, nothing stripped, nothing defaulted.
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!methods.has(method)) continue
        const parsed = Operation.parse(operation)
        const tool = tools.find(
          (candidate) => candidate.name === parsed.operationId
        )
        expect(tool, `${method} ${path}`).toBeDefined()

        const declared = [
          ...parsed.parameters.map((parameter) => parameter.name),
          ...Object.keys(
            parsed.requestBody?.content["application/json"]?.schema
              .properties ?? {}
          ),
        ]
        expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual(
          declared.sort()
        )
      }
    }
  })

  it("keeps userId on the run tool, because the document declares it", async () => {
    const tool = await findTool("postApiScriptsByNameRun")
    // `RunRequestSchema` requires it, so it is a tool parameter like any other. The
    // caller supplies identity until there is auth to derive it from.
    expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("userId")
    expect(tool.inputSchema.required ?? []).toContain("userId")
  })

  it("annotates a read-only route as read-only and a destroying one as destructive", async () => {
    expect((await findTool("getApiTools")).annotations?.readOnlyHint).toBe(true)
    expect(
      (await findTool("deleteApiScriptsByName")).annotations?.destructiveHint
    ).toBe(true)
    // Validation stores nothing and executes nothing, which no HTTP method implies.
    expect((await findTool("postApiValidate")).annotations?.readOnlyHint).toBe(
      true
    )
  })
})

describe("protocol errors", () => {
  it("rejects a tool that was never advertised", async () => {
    const { json } = await post("tools/call", {
      name: "noSuchTool",
      arguments: {},
    })
    // Unlike a failing route, this is the client asking for something that was never
    // advertised — a JSON-RPC error rather than a result. Parsing with ErrorReply is
    // the assertion: it requires `error` present and `result` absent.
    expect(ErrorReply.parse(json).error.message).toContain("noSuchTool")
  })

  it("offers no SSE stream to GET", async () => {
    const response = await app.request("/api/mcp", { method: "GET" })
    expect(response.status).toBe(405)
  })
})
