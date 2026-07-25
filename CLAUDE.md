---
description: pnpm + Turborepo monorepo. Node.js runtime, Hono API hosted inside TanStack Start.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

This is a pnpm workspace driven by Turborepo. Do not use Bun — there are no Bun
APIs or `@types/bun` in this repo.

```
packages/api    Hono API + typed RPC, Drizzle + PGlite, OpenAPI/Scalar
apps/frontend   TanStack Start + shadcn/ui, Vite — serves packages/api at /api/*
apps/backend    the same API on its own port; escape hatch, not the default
```

## Running the apps

`pnpm dev` runs the frontend behind the [portless](https://portless.sh) HTTPS
proxy — one process, serving the site and the API:

```
https://returntypes.localhost         the app
https://returntypes.localhost/api     the Hono API (/api/scalar, /api/openapi)
```

Do not add hardcoded ports or `--port` flags to dev scripts; portless assigns the
port and injects `PORT`/`HOST` (and `--port` for Vite).

Service names come from `scripts/portless-name.mjs`, which prefixes the git branch
on every branch except the default one:

- frontend `returntypes` / `<branch>.returntypes`
- standalone API `returntypes-api` / `<branch>.returntypes-api`

Each app's `dev:portless` script calls that helper itself, so running one app
directly yields the same URL as `pnpm dev`. Add a new app by giving it a
`dev:portless` script in the same shape and listing it in `scripts/dev.mjs`.

`dev:portless` passes `--force` so a re-run reclaims its route from a stale
session rather than erroring; keep it.

Use `portless get <name>` for cross-service URLs rather than hardcoding one.
`pnpm dev:ports` is the escape hatch that skips the proxy.

`pnpm --filter @repo/backend serve:portless` runs the API alone on
`returntypes-api`, for poking at it without the frontend in the way. It is
deliberately not called `dev`, so `turbo run dev` can't start it: PGlite's
exclusive lock means it and `pnpm dev` cannot both hold the database.

## Tooling

- `pnpm install`, `pnpm add <pkg> --filter @repo/api` — never npm/yarn/bun.
- `pnpm dlx <pkg>` instead of `npx`.
- `turbo run <task>` (or the root `pnpm dev` / `build` / `typecheck`) for anything
  crossing packages; `pnpm --filter @repo/<name> <script>` for one.
- Run TypeScript with `tsx <file>`, not `node <file>` or `ts-node`.
- Node does the .env loading: scripts pass `--env-file-if-exists=../../.env`.
  Don't add `dotenv`. The file is the **workspace-root `.env`**, shared by the
  scripts and by the frontend (whose Vite config loads it, since that process
  hosts the API). `apps/frontend/.env` still overrides it if present.

## API (`packages/api`)

Exports `.` (the Hono `app`, `routes`, `closeDb`), `./client` (typed RPC) and
`./schema` (Drizzle tables). It ships as TypeScript source — whoever hosts it
compiles it, so there is no build step.

- **Every route lives under `/api`**, and the prefix belongs to the app
  (`new Hono().route("/api", routes)`), not to whoever hosts it. That is what
  makes both hosts serve identical URLs and the generated document describe the
  paths callers really use. New endpoints go on `routes`; don't add a second
  top-level path.
- Routes are chained off one `new Hono()` so `typeof routes` stays inferable —
  that type is what `src/client.ts` feeds to `hc<AppType>()`. Don't break the
  chain by assigning routes separately.
- `routes` itself is unprefixed, so the `/api` sits in the client's base URL:
  `createClient("/api").tools.$get()`, not `client.api.tools.$get()`.
- `openApiDocument` is generated from `app`, not `routes` — that is where the
  `/api` prefix enters the document. `/api/openapi` and `/api/scalar` carry no
  `describeRoute`, so they stay out of it.
- Zod schemas live in `src/schemas.ts` and carry `.meta({ id })`; `src/openapi.ts`
  hoists those `$defs` into `components.schemas`.
- `src/paths.ts` resolves the data dir and migrations from the **workspace root**,
  found by walking up from the cwd. Three processes with three different cwds open
  the same database, and `import.meta.url` moves when the frontend bundles this
  source, so don't reintroduce cwd- or module-relative paths.
- `@electric-sql/pglite` + `drizzle-orm/pglite` for Postgres, data dir `./pgdata`
  at the workspace root. PGlite holds an exclusive lock, so only one process may
  open it: stop the dev server before `pnpm sync` or `db:studio`. It also needs a
  clean close or the data dir will not reopen. Three things keep that true, all
  load-bearing:
  - `src/db.ts` parks the handle on `globalThis`, because Vite re-evaluates the
    module on every edit and a second `PGlite.create` would race the lock;
  - `src/db.ts` closes on `SIGINT`/`SIGTERM` (`tsx watch` signals on every
    restart);
  - the frontend's `repo:close-db` Vite plugin awaits that close in `closeBundle`,
    the last hook before Vite's own `process.exit`.

  A dir killed with `SIGKILL` is unrecoverable: delete it and re-run `pnpm sync`.
- `node:fs`/`node:path` are fine here.

## Frontend (`apps/frontend`)

- Vite + TanStack Start. File-based routes in `src/routes`; `src/routeTree.gen.ts`
  is generated — don't hand-edit it.
- `src/routes/api.$.ts` serves the whole API: a splat route whose
  `server.handlers.ANY` hands the request straight to `app.fetch` — `@repo/api`
  already owns the `/api` prefix, so nothing is rewritten. That property is
  server-only, so neither the app nor PGlite reaches the client bundle — worth
  re-checking with `grep -r pglite dist/client` if that route changes.
- `ssr.noExternal` keeps `@repo/api` as source for Vite to transform;
  `ssr.external` keeps PGlite a plain Node import, since it ships WASM. PGlite is
  therefore also a direct dependency here — the built server imports it by name
  from `dist/server`, which only resolves against this app's `node_modules`.
- `src/lib/api.ts` is the browser RPC client, based at `/api`. A relative base has
  nothing to resolve against during SSR: to load data on the server, call the app
  in-process from a `createServerFn` (`app.request("/tools")`) instead of making
  the server talk to itself over HTTP.
- shadcn/ui is configured via `components.json`; add components with
  `pnpm dlx shadcn@latest add <component>` from `apps/frontend`.
- Tailwind v4 via `@tailwindcss/vite`; global styles in `src/styles.css`.
- `@/*` maps to `src/*`.
- Tests use `vitest` (+ `@testing-library/react`), not `bun test`.
