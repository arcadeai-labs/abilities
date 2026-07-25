# return-types-test

A pnpm + Turborepo monorepo, served over local HTTPS by [portless](https://portless.sh).

| App             | What it is                                                              |
| --------------- | ----------------------------------------------------------------------- |
| `apps/backend`  | Hono API on Node (`@hono/node-server`), Drizzle + PGlite, OpenAPI/Scalar |
| `apps/frontend` | TanStack Start + shadcn/ui (Vite)                                       |

## Getting started

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs both apps behind the portless HTTPS proxy. There are no port
numbers to remember — each app gets a stable `.localhost` name. Side branches and
worktrees are prefixed so they never collide with the default branch:

| Branch            | Frontend                                        | Backend                                             |
| ----------------- | ----------------------------------------------- | --------------------------------------------------- |
| `main`            | `https://returntypes.localhost`                 | `https://returntypes-api.localhost`                 |
| `feat/tools-page` | `https://feat-tools-page.returntypes.localhost` | `https://feat-tools-page.returntypes-api.localhost` |

`scripts/portless-name.mjs` derives those names: branch labels are slugged into
valid hostname labels, a detached HEAD becomes the short sha, and the default
branch (`origin/HEAD`, else `main`/`master`) is left unprefixed. Print one with
`node scripts/portless-name.mjs returntypes-api`.

```bash
pnpm urls        # portless list — every active route
pnpm dev:ports   # plain turbo, no proxy: backend on :3000, vite on its default
```

Both `dev:portless` scripts pass `--force`, so re-running `pnpm dev` takes the
route back from a previous session instead of failing with "already registered".
The displaced process is shut down cleanly, so the PGlite data dir survives it.

Portless generates and trusts a local CA on first run, so HTTPS works without
browser warnings. `pnpm dlx portless doctor` diagnoses proxy/DNS/CA problems.

## Backend

`apps/backend/.env` holds `ARCADE_API_KEY`; scripts load it with Node's
`--env-file-if-exists`.

```bash
pnpm sync                               # migrate + mirror the Arcade catalog into PGlite
pnpm --filter @repo/api db:migrate      # apply migrations only (stop the server first)
pnpm --filter @repo/api db:generate     # drizzle-kit migrations
pnpm --filter @repo/api rpc-demo        # typed Hono RPC client against a running server
pnpm --filter @repo/api smoke           # manual E2E of validate/store/run (needs sync + key)
```

Endpoints: `POST /seed`, `GET /toolkits`, `GET /tools`, plus `GET /openapi` and
`GET /scalar`.

Two caveats worth knowing:

- PGlite takes an **exclusive lock** on the workspace `pgdata` dir, so stop the server
  before running `sync`, `db:migrate`, or `db:studio`.
- It also needs a clean shutdown or the data dir won't reopen. `server.ts` closes
  it on `SIGINT`/`SIGTERM`; if you ever kill the process with `SIGKILL`, delete
  `pgdata` and re-run `sync` to rebuild it.

`rpc-demo` reads `API_URL`, so point it at the proxied backend:

```bash
API_URL=$(pnpm dlx portless get returntypes-api) pnpm --filter @repo/api rpc-demo
```
