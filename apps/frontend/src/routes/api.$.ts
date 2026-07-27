/**
 * Every /api/* request is answered by the Hono app from `@repo/api`, in this
 * process — no second server, no proxy, no CORS. `server.handlers` is stripped
 * from the client build, so the app and the PGlite database behind it stay on the
 * server.
 *
 * Dynamic import keeps the API (and its TypeScript / DB startup) off the page
 * SSR path — a static import would load them on every `/` request via the
 * route tree.
 *
 * The splat covers the whole API surface, including `/api/openapi` and
 * `/api/scalar`. `@repo/api` registers its own routes under `/api`, so the request
 * passes through unrewritten.
 */
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const { default: app } = await import("@repo/api")
        return app.fetch(request)
      },
    },
  },
})
