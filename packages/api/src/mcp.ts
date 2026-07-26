import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { Context } from "hono"
import { z } from "zod"
import {
  CoverageResponseSchema,
  RevalidateResponseSchema,
  RunReportSchema,
  RunRequestSchema,
  ScriptParamsSchema,
  ScriptSchema,
  ScriptsResponseSchema,
  SeedResponseSchema,
  ToolkitsResponseSchema,
  ToolsQuerySchema,
  ToolsResponseSchema,
  TypesQuerySchema,
  UpsertScriptSchema,
  ValidationSchema,
} from "./schemas"

/**
 * The MCP server is a thin adapter: one tool per REST endpoint, reusing the same
 * Zod schemas the routes validate with and the same descriptions the OpenAPI
 * document carries. Tools call the routes in-process — no HTTP round trip, no
 * second implementation of any behaviour.
 */
type RequestFn = (
  path: string,
  init?: RequestInit
) => Response | Promise<Response>

const name = {
  name: z.string().describe("Script name, or its `scr_…` id."),
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** `{ toolkit: ["a","b"], limit: 5 }` → `?toolkit=a&toolkit=b&limit=5`. */
const query = (params: Record<string, unknown>) => {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value])
      q.append(key, String(item))
  }
  const s = q.toString()
  return s ? `?${s}` : ""
}

/**
 * JSON 2xx responses become `structuredContent` so clients get typed results;
 * anything 4xx/5xx becomes an `isError` result carrying the response body, which
 * the SDK exempts from output-schema validation.
 */
async function toResult(response: Response): Promise<CallToolResult> {
  const text = await response.text()
  const content = [{ type: "text" as const, text }]
  if (!response.ok) return { content, isError: true }
  return response.headers.get("content-type")?.includes("application/json")
    ? { content, structuredContent: JSON.parse(text) }
    : { content }
}

export function createMcpServer(request: RequestFn) {
  const server = new McpServer({
    name: "arcade-tools-mirror",
    version: "1.0.0",
  })

  const call = async (path: string, init?: RequestInit) =>
    toResult(await request(path, init))

  server.registerTool(
    "seed",
    {
      title: "Seed the database",
      description:
        "Paginates the full Arcade tool catalog and mirrors it into the local PGlite database. " +
        "Idempotent: rows upsert on their primary key and rows absent upstream are swept, so " +
        "repeated calls converge on the same state.",
      outputSchema: SeedResponseSchema.shape,
    },
    () => call("/seed", { method: "POST" })
  )

  server.registerTool(
    "list_toolkits",
    {
      title: "List toolkits",
      description:
        "Every distinct toolkit in the database, with its tool count, busiest first.",
      outputSchema: ToolkitsResponseSchema.shape,
    },
    () => call("/toolkits")
  )

  server.registerTool(
    "list_tools",
    {
      title: "List tools",
      description:
        "Tools in the database, optionally narrowed to one or more toolkits. " +
        "Pass `toolkit` as a list or comma-separated; omit it to list everything.",
      inputSchema: ToolsQuerySchema.shape,
      outputSchema: ToolsResponseSchema.shape,
    },
    (args) => call(`/tools${query(args)}`)
  )

  server.registerTool(
    "get_types",
    {
      title: "TypeScript declarations for the catalog",
      description:
        "The ambient declarations scripts are written against: one method per tool, with its " +
        "parameters typed from the catalog and its result typed where the catalog declares a shape, " +
        "plus `z` and `defineScript`. Everything is ambient, so a script imports nothing. This is " +
        "byte-identical to what `validate_script` compiles against, so what you read is what gets " +
        "checked. Filter with `toolkit` — the whole catalog is several megabytes.",
      inputSchema: TypesQuerySchema.shape,
    },
    (args) => call(`/types${query(args)}`)
  )

  server.registerTool(
    "get_coverage",
    {
      title: "Output-schema coverage per toolkit",
      description:
        "Which toolkits declare result shapes and which return `unknown`. Arcade's schema format " +
        "supports nested output types, but most toolkits do not populate them — and the fix is " +
        "upstream in the toolkit definitions, so this is the list that says where to start.",
      outputSchema: CoverageResponseSchema.shape,
    },
    () => call("/coverage")
  )

  server.registerTool(
    "validate_script",
    {
      title: "Validate a script without running it",
      description:
        "Checks a script against the catalog: the submitted contract, the capability grant read off " +
        "`run`'s destructured context parameter, and the type checker. Nothing is stored and nothing " +
        "executes, so this is the loop to iterate in. Diagnostic line numbers refer to your `run` text. " +
        "`ok: true` means the script conforms to its contract — not that it is safe to run, which is " +
        "the sandbox's job.",
      inputSchema: ScriptParamsSchema.shape,
      outputSchema: ValidationSchema.shape,
    },
    (args) => call("/validate", post(args))
  )

  server.registerTool(
    "upsert_script",
    {
      title: "Create or replace a script",
      description:
        "Validates, then stores. An invalid script never lands, so every stored script type-checks " +
        "against its catalog snapshot. Idempotent on `name`: writing the same name again replaces " +
        "it and bumps `version`.",
      inputSchema: {
        ...UpsertScriptSchema.shape,
        name: z
          .string()
          .describe("Script name: lowercase letters, digits and dashes."),
      },
      outputSchema: ScriptSchema.shape,
    },
    ({ name, ...body }) =>
      call(`/scripts/${encodeURIComponent(name)}`, {
        ...post(body),
        method: "PUT",
      })
  )

  server.registerTool(
    "list_scripts",
    {
      title: "List scripts",
      description: "Every stored script.",
      outputSchema: ScriptsResponseSchema.shape,
    },
    () => call("/scripts")
  )

  server.registerTool(
    "get_script",
    {
      title: "Read a script",
      description:
        "Everything that went in: the `run` method and the `input`/`output` schemas exactly " +
        "as submitted, plus the derived grant. Straight out of the database — nothing is re-derived, " +
        "and nothing is stored that the request body did not carry.",
      inputSchema: name,
      outputSchema: ScriptSchema.shape,
    },
    (args) => call(`/scripts/${encodeURIComponent(args.name)}`)
  )

  server.registerTool(
    "get_script_types",
    {
      title: "TypeScript declarations for this script's toolkits",
      description:
        "The ambient declarations covering exactly the toolkits this script destructured — what " +
        "`github` is, and what each of its tools takes and returns. Same text `validate_script` " +
        "compiles against.",
      inputSchema: name,
    },
    (args) => call(`/scripts/${encodeURIComponent(args.name)}/types`)
  )

  server.registerTool(
    "delete_script",
    {
      title: "Delete a script",
      description: "Deletes a stored script by name or id.",
      inputSchema: name,
      outputSchema: { deleted: z.string() },
    },
    (args) =>
      call(`/scripts/${encodeURIComponent(args.name)}`, { method: "DELETE" })
  )

  server.registerTool(
    "run_script",
    {
      title: "Run a script",
      description:
        "Executes inside QuickJS-on-WASM with no globals but `log` and the tools in the script's stored " +
        "grant. Tools run as `userId`, so a run can only reach what that user has already authorized. " +
        "A failed run still returns the full run report — outcome, logs, tool calls — in the result text.",
      inputSchema: { ...RunRequestSchema.shape, ...name },
      outputSchema: RunReportSchema.shape,
    },
    ({ name, ...body }) =>
      call(`/scripts/${encodeURIComponent(name)}/run`, post(body))
  )

  server.registerTool(
    "revalidate",
    {
      title: "Re-check every script against the current catalog",
      description:
        "Pure and cheap, because validation executes nothing. Run this after `seed` to find " +
        "out which scripts a catalog change broke.",
      outputSchema: RevalidateResponseSchema.shape,
    },
    () => call("/revalidate", { method: "POST" })
  )

  return server
}

/**
 * Stateless streamable-HTTP handler: a fresh server and transport per request,
 * so concurrent clients never share a session and there is nothing to clean up.
 */
export function mcpHandler(request: RequestFn) {
  return async (c: Context) => {
    const transport = new StreamableHTTPTransport()
    await createMcpServer(request).connect(transport)
    return transport.handleRequest(c)
  }
}
