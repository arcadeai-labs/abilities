import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DATA_DIR, MIGRATIONS_DIR } from "./paths";
import { tools } from "./schema";

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

  return handle;
}

const handle = (store[HANDLE] ??= await open());

export const pg = handle.pg;

/** Idempotent, and hands every caller the same close promise. */
export const closeDb = handle.close;

export const db = drizzle({ client: pg, schema: { tools } });

export type Db = typeof db;

let migrated: Promise<void> | undefined;

/** Idempotent: drizzle tracks applied migrations, and we only run it once per process. */
export const ensureMigrated = () =>
  (migrated ??= migrate(db, { migrationsFolder: MIGRATIONS_DIR }));
