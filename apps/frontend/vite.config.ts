import { cpSync } from "node:fs"
import { join } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, loadEnv, type Plugin } from "vite"

const workspaceRoot = new URL("../../", import.meta.url).pathname

/** SQL migrations `@repo/api` applies on seed — must ship with the serverless function. */
const drizzleMigrations = join(workspaceRoot, "packages/api/drizzle")

/**
 * This server hosts the API (see src/routes/api.$.ts), so it needs the API's
 * environment. Keeping it in the workspace-root .env means the embedded API and
 * `pnpm --filter @repo/api sync` read one file. TanStack Start loads
 * apps/frontend/.env itself and runs after this, so a local file still wins.
 */
const rootEnv = (): Plugin => ({
  name: "repo:root-env",
  enforce: "pre",
  configResolved: (config) => {
    Object.assign(process.env, loadEnv(config.mode, workspaceRoot, ""))
  },
})

/**
 * PGlite will not reopen a data dir that was left mid-write. Vite runs
 * `closeBundle` from inside `server.close()`, which is the last hook before its
 * own process.exit — the only place a clean close is still guaranteed on Ctrl-C.
 * The handle lives on globalThis because this plugin and the SSR module graph are
 * separate module registries.
 */
const closeDb = (): Plugin => ({
  name: "repo:close-db",
  closeBundle: async () => {
    const handle: { close: () => Promise<void> } | undefined = Reflect.get(
      globalThis,
      "__repoApiDb"
    )
    await handle?.close()
  },
})

/**
 * Nitro wraps `typescript` in a CJS interop helper that does not define
 * `__filename` / `__dirname`. TypeScript reads both at module load, so the
 * ESM chunk throws `ReferenceError` on Vercel and every /api request 500s.
 * Inject ESM equivalents at the top of that chunk only.
 */
const typescriptCjsGlobals = (): Plugin => ({
  name: "repo:typescript-cjs-globals",
  apply: "build",
  renderChunk(code, chunk) {
    if (!chunk.fileName.includes("typescript")) return null
    if (!code.includes("__filename") || code.includes("__repoTsFilename")) {
      return null
    }
    return {
      code:
        `import { fileURLToPath as __repoFileURLToPath } from "node:url";\n` +
        `import { dirname as __repoDirname } from "node:path";\n` +
        `const __filename = __repoFileURLToPath(import.meta.url);\n` +
        `const __dirname = __repoDirname(__filename);\n` +
        `void "__repoTsFilename";\n` +
        code,
      map: null,
    }
  },
})

const config = defineConfig({
  server: {
    /**
     * Open the URL you actually use. Under `pnpm dev` this server sits behind the
     * portless proxy, which injects `PORTLESS_URL`; the raw Vite port still serves
     * the app but on a different origin, without HTTPS, and it is not the URL
     * anything else in the repo refers to. Vite resolves a string `open` with
     * `new URL(open, localUrl)`, where an absolute value wins — so this opens the
     * proxied host when there is one and the plain port under `pnpm dev:ports`.
     *
     * `BROWSER=none` opts out. Vitest loads this config too and must not launch
     * anything.
     */
    open: process.env.VITEST ? false : (process.env.PORTLESS_URL ?? true),
  },
  resolve: { tsconfigPaths: true },
  ssr: {
    // @repo/api is TypeScript source, so Vite has to transform it rather than hand
    // it to Node. PGlite ships WASM and postgres is a Node driver — both stay
    // plain Node imports.
    noExternal: ["@repo/api"],
    external: ["@electric-sql/pglite", "postgres"],
  },
  plugins: [
    rootEnv(),
    closeDb(),
    typescriptCjsGlobals(),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    // Seed/migrate read `packages/api/drizzle/meta/_journal.json` from disk. The
    // API source is bundled, so those files are not traced in — copy them into
    // the server output under the same relative path `MIGRATIONS_DIR` uses.
    //
    // Register via `modules` + `hook()`, not `hooks: { compiled }`: a config-level
    // `compiled` replaces the Vercel preset's own compiled handler (which writes
    // `.vercel/output/config.json`), and Vercel then looks for a `dist` folder.
    nitro({
      modules: [
        (nitro) => {
          nitro.hooks.hook("compiled", () => {
            cpSync(
              drizzleMigrations,
              join(nitro.options.output.serverDir, "packages/api/drizzle"),
              { recursive: true }
            )
          })
        },
      ],
    }),
    viteReact(),
  ],
})

export default config
