import { createClient } from "@repo/api/client"

/**
 * Typed RPC against our own /api mount — same origin, so the bare path is enough
 * and every response type comes from the server's route table.
 *
 * Browser only: a relative base has nothing to resolve against during SSR. To
 * load data on the server, call the Hono app directly from inside a
 * `createServerFn` (`import app from "@repo/api"; app.request("/tools")`) rather
 * than making the server talk to itself over HTTP.
 */
export const api = createClient("/api")
