import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

const workspaceRoot = new URL("../../", import.meta.url).pathname

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
    // it to Node. PGlite ships WASM and stays a plain Node import.
    noExternal: ["@repo/api"],
    external: ["@electric-sql/pglite"],
  },
  plugins: [
    rootEnv(),
    closeDb(),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
