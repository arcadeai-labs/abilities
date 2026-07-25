import { defineConfig, loadEnv, type Plugin } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

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
    await (globalThis as { __repoApiDb?: { close: () => Promise<void> } }).__repoApiDb?.close()
  },
})

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: {
    // @repo/api is TypeScript source, so Vite has to transform it rather than hand
    // it to Node. PGlite ships WASM and stays a plain Node import.
    noExternal: ["@repo/api"],
    external: ["@electric-sql/pglite"],
  },
  plugins: [rootEnv(), closeDb(), devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
