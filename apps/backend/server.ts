import { serve } from "@hono/node-server";
import app from "./src/app";
import { pg } from "./src/db";

const port = Number(process.env.PORT ?? 3000);

const server = serve({
  port,
  fetch: app.fetch,
  // POST /seed holds the connection for the whole sync and sends nothing meanwhile;
  // Node's 5-minute requestTimeout would abort it mid-run. 0 disables the limit.
  serverOptions: { requestTimeout: 0 },
});

/**
 * PGlite must be closed before the process goes away or its data dir is left
 * mid-write and won't reopen. `tsx watch` signals the old process on every
 * restart, so without this an ordinary edit can corrupt ./pgdata.
 */
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  server.close();
  await pg.close();
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, shutdown);

// portless serves this behind https://api.<base>.localhost; PORTLESS_URL carries
// that name so the log points at the URL actually being used.
const url = process.env.PORTLESS_URL ?? `http://localhost:${port}`;
console.log(`listening on ${url}`);
console.log(`  scalar   ${url}/scalar`);
console.log(`  openapi  ${url}/openapi`);
