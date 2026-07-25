/**
 * Every /api/* request is answered by the Hono app from `@repo/api`, in this
 * process — no second server, no proxy, no CORS. `server.handlers` is stripped
 * from the client build, so the app and the PGlite database behind it stay on the
 * server.
 *
 * The splat covers the whole API surface, including `/api/openapi` and
 * `/api/scalar`. `@repo/api` registers its own routes under `/api`, so the request
 * passes through unrewritten.
 */
import app from "@repo/api"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/$")({
  server: { handlers: { ANY: ({ request }) => app.fetch(request) } },
})
