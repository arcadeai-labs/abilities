import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * Three different processes may open this package's embedded PGlite data dir —
 * the frontend dev server (cwd `apps/frontend`), the standalone API (cwd
 * `apps/backend`) and the `sync`/`db:studio` scripts (cwd `packages/api`) — and
 * they must all land on the same directory when `POSTGRES_URL` is unset.
 * Relative paths can't do that, and `import.meta.url` moves when the frontend
 * bundles this source into `.output`, so the anchor is the workspace root found
 * by walking up from the cwd.
 *
 * On Vercel there is no `pnpm-workspace.yaml` in the function filesystem. Real
 * Postgres (`POSTGRES_URL`) does not need the workspace root for the data dir;
 * falling back to cwd keeps module load from throwing before the Postgres
 * branch can run. Migrations still need a real folder at
 * `{cwd}/packages/api/drizzle`: the frontend Nitro build copies `drizzle/`
 * there so `POST /seed` (which runs `migrateDb`) can find `meta/_journal.json`.
 */
function findWorkspaceRoot(from = process.cwd()): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

export const WORKSPACE_ROOT = findWorkspaceRoot() ?? resolve(process.cwd())

/** One database for the whole workspace; `drizzle.config.ts` points here too. */
export const DATA_DIR =
  process.env.PGLITE_DATA_DIR ?? join(WORKSPACE_ROOT, "pgdata")

/** `drizzle/` ships with this package; on Vercel the Nitro build mirrors it here. */
export const MIGRATIONS_DIR = join(WORKSPACE_ROOT, "packages/api/drizzle")
