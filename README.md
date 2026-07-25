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
numbers to remember — each app gets a stable `.localhost` name, and the URL
carries the current git branch so branches and worktrees never collide:

| Branch            | Frontend                                     | Backend                                          |
| ----------------- | -------------------------------------------- | ------------------------------------------------ |
| _(no git repo)_   | `https://returntypes.localhost`              | `https://api.returntypes.localhost`              |
| `main`            | `https://main.returntypes.localhost`         | `https://api.main.returntypes.localhost`         |
| `feat/tools-page` | `https://feat-tools-page.returntypes.localhost` | `https://api.feat-tools-page.returntypes.localhost` |

`scripts/portless-base.mjs` derives that base — branch names are slugged into a
valid hostname label, and a detached HEAD becomes the short sha. Print the
current one with `node scripts/portless-base.mjs`.

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
pnpm --filter @repo/backend sync         # mirror the Arcade catalog into PGlite
pnpm --filter @repo/backend db:generate  # drizzle-kit migrations
pnpm --filter @repo/backend rpc-demo     # typed Hono RPC client against a running server
```

Endpoints: `POST /seed`, `GET /toolkits`, `GET /tools`, plus `GET /openapi` and
`GET /scalar`.

Two caveats worth knowing:

- PGlite takes an **exclusive lock** on `apps/backend/pgdata`, so stop the server
  before running `sync` or `db:studio`.
- It also needs a clean shutdown or the data dir won't reopen. `server.ts` closes
  it on `SIGINT`/`SIGTERM`; if you ever kill the process with `SIGKILL`, delete
  `apps/backend/pgdata` and re-run `sync` to rebuild it.

`rpc-demo` reads `API_URL`, so point it at the proxied backend:

```bash
API_URL=$(pnpm dlx portless get api.returntypes) pnpm --filter @repo/backend rpc-demo
```
