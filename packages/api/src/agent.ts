import { anthropic } from "@ai-sdk/anthropic"
import { createMCPClient } from "@ai-sdk/mcp"
import { createAgentUIStreamResponse, isStepCount, ToolLoopAgent } from "ai"
import type { Context } from "hono"

/**
 * A chat agent over the Messages API, streamed to the browser as an AI SDK UI
 * message stream.
 *
 * It sits beside `/api/mcp` on the app rather than on the `routes` chain, for the
 * same reasons that one does: an SSE stream is a transport endpoint, not a catalog
 * operation. Off the chain it stays out of `AppType`, so the typed RPC client is
 * unchanged — a generated `$post` returning a `Response` would be a worse way to
 * consume a token stream than `useChat` — and, carrying no `describeRoute`, it
 * stays out of the OpenAPI document and therefore out of the generated MCP tools.
 *
 * Tools come from that MCP server via `createMCPClient`, not a parallel hand-written
 * list: the agent sees the same derived tools every other MCP client does. The client
 * hits `/api/mcp` through `app.request` (loaded lazily so this file never imports
 * `app` at the top level — `app` already imports this) and never leaves the process.
 *
 * `ANTHROPIC_API_KEY` comes from the environment, which every host of this package
 * already loads from the workspace-root .env.
 */

/**
 * `stopWhen` is the loop bound. The agent runs tool-call steps until a stop
 * condition holds; with the MCP toolset that is what keeps a chat turn from
 * walking the catalog forever.
 */
export const agentHandler = async (c: Context) => {
  const { messages } = await c.req.json()
  // Lazy: `./app` imports this module, so a top-level import would cycle.
  const { default: app } = await import("./app")

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      // Required by the transport; `fetch` serves the request in-process.
      url: "http://mcp.local/api/mcp",
      fetch: async (_input, init) => app.request("/api/mcp", init),
    },
  })

  try {
    const tools = await mcpClient.tools()
    const agent = new ToolLoopAgent({
      model: anthropic("claude-sonnet-5"),
      instructions:
        mcpClient.instructions ??
        "You help explore and operate the Arcade tools mirror.",
      tools,
      stopWhen: isStepCount(10),
    })

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      // Close once the UI stream finishes — mid-turn tool calls still need the
      // client, so this cannot run in a `finally` around the handler itself.
      onEnd: async () => {
        await mcpClient.close()
      },
    })
  } catch (error) {
    await mcpClient.close()
    throw error
  }
}
