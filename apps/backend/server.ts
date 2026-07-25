/**
 * The API on its own port, for poking at it without the frontend in the way. The
 * frontend serves this same app at /api/* and `pnpm dev` runs only that, so this
 * is the escape hatch rather than the default — and PGlite's exclusive lock means
 * only one of the two may hold the database at a time.
 */
import { serve } from "@hono/node-server";
import app, { closeDb } from "@repo/api";

const port = Number(process.env.PORT ?? 3000);

const server = serve({
  port,
  fetch: app.fetch,
  // POST /seed holds the connection for the whole sync and sends nothing meanwhile;
  // Node's 5-minute requestTimeout would abort it mid-run. 0 disables the limit.
  serverOptions: { requestTimeout: 0 },
});

// @repo/api closes PGlite on SIGINT/SIGTERM itself — this only adds shutting the
// listener before that happens, so an in-flight request isn't cut mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void closeDb();
  });
}

// portless serves this behind https://<name>.localhost; PORTLESS_URL carries that
// name so the log points at the URL actually being used.
const url = process.env.PORTLESS_URL ?? `http://localhost:${port}`;
console.log(`listening on ${url}`);
console.log(`  scalar   ${url}/api/scalar`);
console.log(`  openapi  ${url}/api/openapi`);
