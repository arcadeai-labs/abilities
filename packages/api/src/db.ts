import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DATA_DIR, MIGRATIONS_DIR } from "./paths";
import { runs, scripts, tools } from "./schema";

export { DATA_DIR };

type Handle = { pg: PGlite; close: () => Promise<void> };

/**
 * PGlite takes an exclusive lock on its data dir, so a process may only ever hold
 * one instance — and module scope alone can't guarantee that here: the frontend
 * hosts this package as Vite source, and Vite re-evaluates a module whenever
 * something it imports is edited. Parking the handle on `globalThis` outlives
 * those re-evaluations, so an edit reuses the open database instead of racing
 * itself for the lock.
 */
const HANDLE = "__repoApiDb" as const;
const store = globalThis as typeof globalThis & { [HANDLE]?: Handle };

async function open(): Promise<Handle> {
  const pg = await PGlite.create(DATA_DIR);

  let closing: Promise<void> | undefined;
  const handle: Handle = { pg, close: () => (closing ??= pg.close()) };

  // A data dir left mid-write will not reopen, and every host gets signalled as a
  // matter of routine — `tsx watch` on each restart, Ctrl-C on the dev server — so
  // closing on the way out is what keeps ./pgdata reusable.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void handle.close().finally(() => process.exit(0)));
  }

  // Covers the processes that just end: `pnpm sync`, `vitest`, any one-shot script
  // that forgets to close. `beforeExit` fires once the loop drains and awaits work
  // scheduled inside it, so the close completes — and it never fires while a server
  // is listening, so this cannot cut a running host off from its database.
  process.once("beforeExit", () => void handle.close());

  return handle;
}

const handle = (store[HANDLE] ??= await open());

export const pg = handle.pg;

/** Idempotent, and hands every caller the same close promise. */
export const closeDb = handle.close;

export const db = drizzle({ client: pg, schema: { tools, scripts, runs } });

export type Db = typeof db;

let migrated: Promise<void> | undefined;

/**
 * Apply pending drizzle migrations. Idempotent — drizzle records what ran.
 *
 * Call this from `pnpm db:migrate` or `pnpm sync`, not from request handlers:
 * schema changes belong outside the request path so a deploy can't surprise a
 * live process mid-query. PGlite is process-local here, so the exclusive lock
 * also means migrate and the server cannot both hold the data dir — stop the
 * host, migrate, then start it again.
 */
export const migrateDb = () =>
  (migrated ??= migrate(db, { migrationsFolder: MIGRATIONS_DIR }));
