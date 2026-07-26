import { anthropic } from "@ai-sdk/anthropic"
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
 * `ANTHROPIC_API_KEY` comes from the environment, which every host of this package
 * already loads from the workspace-root .env.
 */

/**
 * `stopWhen` is the loop bound. The agent runs tool-call steps until a stop
 * condition holds; with no tools registered it finishes in one, but the bound is
 * what keeps that true once tools are added.
 */
const agent = new ToolLoopAgent({
  model: anthropic("claude-sonnet-5"),
  stopWhen: isStepCount(10),
})

export const agentHandler = async (c: Context) => {
  const { messages } = await c.req.json()
  return createAgentUIStreamResponse({ agent, uiMessages: messages })
}
