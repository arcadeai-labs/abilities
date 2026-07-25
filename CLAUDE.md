---
description: pnpm + Turborepo monorepo. Node.js runtime, Hono on @hono/node-server, TanStack Start on the frontend.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

This is a pnpm workspace driven by Turborepo. Do not use Bun — there are no Bun
APIs or `@types/bun` in this repo.

```
apps/backend    Hono API on Node, Drizzle + PGlite, OpenAPI/Scalar
apps/frontend   TanStack Start + shadcn/ui, Vite
```

## Running the apps

`pnpm dev` runs both behind the [portless](https://portless.sh) HTTPS proxy — do
not add hardcoded ports or `--port` flags to dev scripts, portless assigns the
port and injects `PORT`/`HOST` (and `--port` for Vite).

Service names come from `scripts/portless-name.mjs`, which prefixes the git branch
on every branch except the default one:

- frontend `returntypes` / `<branch>.returntypes`
- backend `returntypes-api` / `<branch>.returntypes-api`

Each app's `dev:portless` script calls that helper itself, so running one app
directly yields the same URL as `pnpm dev`. Add a new app by giving it a
`dev:portless` script in the same shape and listing it in `scripts/dev.mjs`.

Both `dev:portless` scripts pass `--force` so a re-run reclaims its route from a
stale session rather than erroring; keep it.

Use `portless get <name>` for cross-service URLs rather than hardcoding one.
`pnpm dev:ports` is the escape hatch that skips the proxy.

## Tooling

- `pnpm install`, `pnpm add <pkg> --filter @repo/backend` — never npm/yarn/bun.
- `pnpm dlx <pkg>` instead of `npx`.
- `turbo run <task>` (or the root `pnpm dev` / `build` / `typecheck`) for anything
  crossing both apps; `pnpm --filter @repo/<app> <script>` for one app.
- Run TypeScript with `tsx <file>`, not `node <file>` or `ts-node`.
- Node does the .env loading: scripts pass `--env-file-if-exists=.env`. Don't add `dotenv`.

## Backend (`apps/backend`)

- `serve()` from `@hono/node-server` — not `Bun.serve`, not `express`.
- `@electric-sql/pglite` + `drizzle-orm/pglite` for Postgres. PGlite holds an
  exclusive lock on `pgdata`, so only one process may open it: stop the server
  before `pnpm sync` or `db:studio`. It also needs a clean close or the data dir
  will not reopen — `server.ts` handles `SIGINT`/`SIGTERM`; keep that in place,
  since `tsx watch` signals the process on every restart. A dir killed with
  `SIGKILL` is unrecoverable: delete it and re-run `sync`.
- Routes are chained off one `new Hono()` so `typeof routes` stays inferable —
  that type is what `src/client.ts` feeds to `hc<AppType>()`. Don't break the
  chain by assigning routes separately.
- Zod schemas live in `src/schemas.ts` and carry `.meta({ id })`; `src/openapi.ts`
  hoists those `$defs` into `components.schemas`.
- `node:fs`/`node:path` are fine here.

## Frontend (`apps/frontend`)

- Vite + TanStack Start. File-based routes in `src/routes`; `src/routeTree.gen.ts`
  is generated — don't hand-edit it.
- shadcn/ui is configured via `components.json`; add components with
  `pnpm dlx shadcn@latest add <component>` from `apps/frontend`.
- Tailwind v4 via `@tailwindcss/vite`; global styles in `src/styles.css`.
- `@/*` maps to `src/*`.
- Tests use `vitest` (+ `@testing-library/react`), not `bun test`.
