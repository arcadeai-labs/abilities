/**
 * Exercises the typed RPC client against a running server. Every response below
 * is fully typed from `AppType` — no generics, no casts, no schema duplication.
 */
import { createClient } from "./client"

// Points at the standalone server by default; set API_URL to the frontend
// (e.g. https://returntypes.localhost/api) to exercise that instead. The base
// carries `/api` because `routes` is registered under that prefix.
const client = createClient(process.env.API_URL ?? "http://localhost:3000/api")

const toolkitsRes = await client.toolkits.$get()
if (!toolkitsRes.ok)
  throw new Error(`GET /toolkits failed: ${toolkitsRes.status}`)
const { total, toolkits } = await toolkitsRes.json()
console.log(`${total} toolkits; top 3:`)
for (const t of toolkits.slice(0, 3))
  console.log(`  ${t.name.padEnd(24)} ${t.toolCount}`)

// `toolkit` accepts a repeated param; `limit`/`offset` are coerced from strings.
const toolsRes = await client.tools.$get({
  query: { toolkit: ["Slack", "Zoom"], limit: "5" },
})
if (!toolsRes.ok) throw new Error(`GET /tools failed: ${toolsRes.status}`)
const page = await toolsRes.json()
console.log(
  `\n${page.total} tools in ${page.toolkits?.join(", ")} (showing ${page.tools.length}):`
)
for (const t of page.tools) console.log(`  ${t.fullyQualifiedName}`)
