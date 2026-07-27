import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import {
  drizzle as drizzlePglite,
  type PgliteDatabase,
} from "drizzle-orm/pglite"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js"
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { DATA_DIR, MIGRATIONS_DIR } from "./paths"
import { runs, scripts, tools } from "./schema"

export { DATA_DIR }

/** Where this process's `db` points — safe to log (password stripped). */
export function describeDb(): string {
  if (POSTGRES_URL) {
    try {
      const url = new URL(POSTGRES_URL)
      url.password = ""
      return `postgres ${url.toString().replace(/\/$/, "")}`
    } catch {
      return "postgres (POSTGRES_URL set, unparseable)"
    }
  }
  return `pglite ${DATA_DIR}`
}

const schema = { tools, scripts, runs }

export type Db = PgliteDatabase<typeof schema>

function isDb(value: unknown): value is Db {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "insert" in value &&
    "transaction" in value
  )
}

/** Postgres-js and PGlite drizzle clients share the query surface we use. */
function asDb(value: unknown): Db {
  if (!isDb(value)) throw new Error("expected a drizzle database client")
  return value
}

type Handle = {
  db: Db
  close: () => Promise<void>
  migrate: () => Promise<void>
}

/**
 * One database handle per process. Module scope alone can't guarantee that here:
 * the frontend hosts this package as Vite source, and Vite re-evaluates a module
 * whenever something it imports is edited. Parking the handle on `globalThis`
 * outlives those re-evaluations, so an edit reuses the open database instead of
 * opening a second one (against the same PGlite dir, or a second Postgres pool).
 *
 * Across processes with PGlite, see {@link claimDataDir}. Real Postgres needs no
 * such guard — the server serializes writers itself.
 */
const HANDLE = "__repoApiDb" as const

const POSTGRES_URL = process.env.POSTGRES_URL

/**
 * Refuses to open the data dir if another live process already has it.
 *
 * PGlite is documented as taking an exclusive lock, but it does not actually stop a
 * second process here: both open the dir, each keeps its own page cache, and their
 * flushes interleave. The result is not an error — it is silent corruption. A run
 * of `pnpm db:migrate` against a dir a dev server was holding left `pg_attribute`
 * missing four columns and the migration journal disagreeing with the schema, and
 * nothing surfaced until an unrelated query failed much later.
 *
 * So the guard is ours: an atomically-created owner file naming the live pid. A
 * crashed process leaves a stale one, which is detected and reclaimed — the point
 * is only to turn a corrupted database into a message that says what to stop.
 *
 * Only used when `POSTGRES_URL` is unset.
 */
function claimDataDir(): () => void {
  const owner = join(DATA_DIR, "owner.json")
  const mine = JSON.stringify({
    pid: process.pid,
    argv: process.argv.slice(1, 3),
  })

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      // `wx` fails if the file exists, so the check and the claim are one step.
      writeFileSync(owner, mine, { flag: "wx" })
      break
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? error.code : undefined
      if (code !== "EEXIST") throw error

      let held: { pid?: number; argv?: string[] } = {}
      try {
        held = JSON.parse(readFileSync(owner, "utf8"))
      } catch {
        // An unreadable owner file is as good as a stale one.
      }

      if (
        held.pid !== undefined &&
        held.pid !== process.pid &&
        alive(held.pid)
      ) {
        throw new Error(
          `${DATA_DIR} is already open by pid ${held.pid} (${held.argv?.join(" ") ?? "unknown"}). ` +
            "PGlite gives each process its own page cache, so a second writer corrupts the " +
            "database rather than failing. Stop that process first — or run `pnpm dev:ports` " +
            "on a different PGLITE_DATA_DIR, or set POSTGRES_URL to use a shared Postgres."
        )
      }

      rmSync(owner, { force: true })
    }
  }

  return () => rmSync(owner, { force: true })
}

function installCloseHooks(close: () => Promise<void>): void {
  // A PGlite data dir left mid-write will not reopen, and every host gets signalled
  // as a matter of routine — `tsx watch` on each restart, Ctrl-C on the dev server —
  // so closing on the way out is what keeps ./pgdata reusable. For Postgres this
  // just drains the pool cleanly.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void close().finally(() => process.exit(0)))
  }

  // Covers the processes that just end: `pnpm sync`, `vitest`, any one-shot script
  // that forgets to close. `beforeExit` fires once the loop drains and awaits work
  // scheduled inside it, so the close completes — and it never fires while a server
  // is listening, so this cannot cut a running host off from its database.
  process.once("beforeExit", () => void close())
}

async function openPglite(): Promise<Handle> {
  const releaseOwner = claimDataDir()
  const client = await PGlite.create(DATA_DIR)
  const db = drizzlePglite({ client, schema })

  let closing: Promise<void> | undefined
  const close = () => (closing ??= client.close().finally(releaseOwner))
  installCloseHooks(close)

  return {
    db,
    close,
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
  }
}

function openPostgres(url: string): Handle {
  const client = postgres(url)
  const pgDb = drizzlePostgres({ client, schema })

  let closing: Promise<void> | undefined
  const close = () =>
    (closing ??= client.end({ timeout: 5 }).then(() => undefined))
  installCloseHooks(close)

  return {
    db: asDb(pgDb),
    close,
    migrate: () => migratePostgres(pgDb, { migrationsFolder: MIGRATIONS_DIR }),
  }
}

async function open(): Promise<Handle> {
  if (POSTGRES_URL) return openPostgres(POSTGRES_URL)
  return openPglite()
}

/** Reuses the handle a previous evaluation of this module parked on `globalThis`. */
async function acquire(): Promise<Handle> {
  const existing: Handle | undefined = Reflect.get(globalThis, HANDLE)
  if (existing) return existing
  const opened = await open()
  Reflect.set(globalThis, HANDLE, opened)
  return opened
}

const handle = await acquire()

/** Idempotent, and hands every caller the same close promise. */
export const closeDb = handle.close

export const db = handle.db

let migrated: Promise<void> | undefined

/**
 * Apply pending drizzle migrations. Idempotent — drizzle records what ran.
 *
 * Call this from `pnpm db:migrate` or `pnpm sync`, not from request handlers:
 * schema changes belong outside the request path so a deploy can't surprise a
 * live process mid-query. With PGlite, stop the host first — migrating underneath
 * a running server is what {@link claimDataDir} exists to refuse. With
 * `POSTGRES_URL`, concurrent migrate + serve is fine at the connection level;
 * still prefer doing schema changes deliberately.
 */
export const migrateDb = () => (migrated ??= handle.migrate())
