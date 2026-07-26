/**
 * What the scripts UI reads, spelled out structurally instead of imported from
 * the RPC client.
 *
 * `@/hooks/api`'s `Script` and `RunReport` both satisfy these, so the app hands
 * responses straight through — but a story can write one by hand without standing
 * up a client, and each molecule can declare exactly the fields it needs.
 * `outcome` stays `unknown` for the same reason it is `unknown` on the wire: it is
 * discriminated on `kind`, and the view narrows it where it renders.
 */

/**
 * What one declared toolkit will ask the end user to authorize. `requiresAuth` is
 * not `scopes.length > 0`: a provider can demand a connected account while declaring
 * no scopes per tool, and "never called" is a third state again.
 */
export type ToolkitAuthorization = {
  toolkit: string
  tools: string[]
  scopes: string[]
  requiresAuth: boolean
}

export type ScriptView = {
  id: string
  name: string
  description: string | null
  run: string
  input: unknown
  output: unknown
  version: number
  grant: Record<string, string>
  toolkits: string[]
  authorization: ToolkitAuthorization[]
  snapshotId: string
  stale: boolean
  createdAt: string
  updatedAt: string
}

export type RunReportView = {
  runId: string
  outcome: unknown
  logs: string[]
  toolCalls: {
    path: string
    qualifiedName: string
    ok: boolean
    durationMs: number
    error?: string
  }[]
  drift: { tool: string; violations: { path: string; message: string }[] }[]
  durationMs: number
}
