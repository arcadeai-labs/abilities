/**
 * The MCP server is generated from the OpenAPI document, so what is worth testing
 * is the derivation, not a list of tools: every documented operation becomes a
 * tool, its arguments come back apart into the request the route expects, and a
 * schema that travels alone still resolves.
 *
 * These go through the real transport — `app.request("/api/mcp", …)` with real
 * JSON-RPC — and the calls they make are plain database reads, so unlike the rest
 * of the suite this file needs no Arcade key.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import app from "./app"
import { migrateDb } from "./db"

let id = 0

/** One JSON-RPC round trip. The transport replies as SSE, so unwrap the frame. */
async function rpc(method: string, params?: unknown) {
  const response = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  })
  expect(response.ok).toBe(true)
  const frame = (await response.text())
    .split("\n")
    .find((line) => line.startsWith("data: "))
  if (!frame) throw new Error("no SSE data frame in the response")
  const message = JSON.parse(frame.slice(6))
  if (message.error) throw new Error(JSON.stringify(message.error))
  return message.result
}

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  rpc("tools/call", { name, arguments: args })

type Tool = {
  name: string
  description: string
  inputSchema: {
    properties?: Record<string, { description?: string; default?: unknown }>
    required?: string[]
    $defs?: Record<string, unknown>
  }
  outputSchema?: { type: string; $defs?: Record<string, unknown> }
  annotations?: { readOnlyHint?: boolean }
}

/** Only the part of the document the derivation is checked against. */
const DocumentSchema = z.object({
  paths: z.record(
    z.string(),
    z.record(z.string(), z.object({ operationId: z.string() }))
  ),
})

let tools: Map<string, Tool>
let document: z.infer<typeof DocumentSchema>

beforeAll(async () => {
  await migrateDb()
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0" },
  })
  const listed = await rpc("tools/list")
  tools = new Map(listed.tools.map((tool: Tool) => [tool.name, tool]))
  document = DocumentSchema.parse(
    await (await app.request("/api/openapi")).json()
  )
})

const operations = () =>
  Object.values(document.paths).flatMap((item) => Object.values(item))

describe("the tool table", () => {
  it("has one tool per documented operation, named after its operationId", () => {
    const expected = operations().map((operation) =>
      operation.operationId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
    )
    expect([...tools.keys()].sort()).toEqual(expected.sort())
  })

  it("describes every tool", () => {
    for (const tool of tools.values()) expect(tool.description).not.toBe("")
  })

  it("marks the read-only tools and only those", () => {
    const readOnly = [...tools.values()]
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name)
    expect(readOnly.sort()).toEqual([
      "get_coverage",
      "get_script",
      "get_types",
      "list_scripts",
      "list_toolkits",
      "list_tools",
    ])
  })
})

describe("argument schemas", () => {
  it("carries a path parameter with the description the route gave it", () => {
    const name = tools.get("get_script")?.inputSchema.properties?.name
    expect(name?.description).toContain("scr_")
    expect(tools.get("get_script")?.inputSchema.required).toEqual(["name"])
  })

  it("flattens the path parameter and the body into one argument object", () => {
    const input = tools.get("upsert_script")?.inputSchema
    // `name` addresses the script and the rest is the body; a caller sees one object.
    expect(Object.keys(input?.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "input", "output", "run", "toolkits"])
    )
    expect(input?.required?.sort()).toEqual(["input", "name", "output", "run"])
  })

  it("asks upsert authors for reasonable input defaults", () => {
    const tool = tools.get("upsert_script")
    expect(tool?.description).toMatch(/default/i)
    expect(tool?.inputSchema.properties?.input?.description).toMatch(/default/i)
  })

  it("keeps a query parameter's default and leaves it optional", () => {
    const input = tools.get("list_tools")?.inputSchema
    expect(input?.properties?.limit?.default).toBe(100)
    expect(input?.required).toEqual([])
  })

  it("resolves component references into self-contained `$defs`", () => {
    const output = tools.get("list_tools")?.outputSchema
    expect(output?.$defs).toHaveProperty("Tool")
    expect(JSON.stringify(output)).not.toContain("#/components/schemas/")
  })

  it("declares no output schema for a route that does not return JSON", () => {
    expect(tools.get("get_types")?.outputSchema).toBeUndefined()
    expect(tools.get("list_toolkits")?.outputSchema?.type).toBe("object")
  })
})

describe("calling a tool", () => {
  it("returns a 2xx JSON body as structured content", async () => {
    const result = await callTool("list_toolkits")
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.total).toBeGreaterThan(0)
  })

  it("routes query parameters into the query string", async () => {
    const result = await callTool("list_tools", { toolkit: ["Math"], limit: 2 })
    expect(result.structuredContent.toolkits).toEqual(["Math"])
    expect(result.structuredContent.tools).toHaveLength(2)
  })

  it("returns text as text, with no structured content", async () => {
    const result = await callTool("get_types", { toolkit: "math" })
    expect(result.structuredContent).toBeUndefined()
    expect(result.content[0].text).toContain("declare")
  })

  it("reports a non-2xx as an error carrying the response body", async () => {
    const result = await callTool("get_script", { name: "no-such-script" })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).error).toBe("not_found")
  })

  it("rejects a tool it does not have", async () => {
    const result = await callTool("not_a_tool")
    expect(result.isError).toBe(true)
  })
})
