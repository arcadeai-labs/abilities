import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * Three different processes open this package's data dir — the frontend dev
 * server (cwd `apps/frontend`), the standalone API (cwd `apps/backend`) and the
 * `sync`/`db:studio` scripts (cwd `packages/api`) — and they must all land on the
 * same PGlite directory. Relative paths can't do that, and `import.meta.url`
 * moves when the frontend bundles this source into `.output`, so the anchor is
 * the workspace root found by walking up from the cwd.
 */
function findWorkspaceRoot(from = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    if (dirname(dir) === dir)
      throw new Error(`no pnpm-workspace.yaml above ${from}`)
  }
}

export const WORKSPACE_ROOT = findWorkspaceRoot()

/** One database for the whole workspace; `drizzle.config.ts` points here too. */
export const DATA_DIR =
  process.env.PGLITE_DATA_DIR ?? join(WORKSPACE_ROOT, "pgdata")

/** `drizzle/` ships with this package, so its path is relative to the package. */
export const MIGRATIONS_DIR = join(WORKSPACE_ROOT, "packages/api/drizzle")
