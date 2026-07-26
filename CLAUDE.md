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

Starting the frontend opens that URL in a browser. `server.open` in
`apps/frontend/vite.config.ts` reads portless's `PORTLESS_URL` so it opens the
proxied host rather than the raw Vite port, and falls back to the plain port under
`pnpm dev:ports`. `BROWSER=none` turns it off; Vite skips it on restarts.

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
deliberately not called `dev`, so `turbo run dev` can't start it: it and `pnpm dev`
cannot both hold the database.

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
  at the workspace root. **PGlite does not actually enforce an exclusive lock**
  across processes, whatever the docs say: two openers each get their own page
  cache and their flushes interleave, which corrupts the database *silently* rather
  than erroring. Running `db:migrate` under a live dev server left `pg_attribute`
  missing four columns and the migration journal disagreeing with the schema, and
  nothing surfaced until an unrelated query failed later. So `src/db.ts` claims an
  `owner.json` naming its pid and refuses to open a dir another live process holds
  — stop the dev server before `pnpm sync`, `db:migrate` or `db:studio`.

  It also needs a clean close or the data dir will not reopen. Three things keep
  that true, all load-bearing:
  - `src/db.ts` parks the handle on `globalThis`, because Vite re-evaluates the
    module on every edit and a second `PGlite.create` would race the lock;
  - `src/db.ts` closes on `SIGINT`/`SIGTERM` (`tsx watch` signals on every
    restart);
  - the frontend's `repo:close-db` Vite plugin awaits that close in `closeBundle`,
    the last hook before Vite's own `process.exit`.

  A dir killed with `SIGKILL` is unrecoverable: delete it and re-run `pnpm sync`.
  Stop hosts with `SIGTERM` and wait — the owner file is released on the way out,
  and a stale one left by a crash is reclaimed automatically.
- `node:fs`/`node:path` are fine here.
- `pnpm --filter @repo/api test` runs vitest. **The suite has no mocks** — it calls
  the real Arcade API through the real executor, so it needs `ARCADE_API_KEY` and a
  synced catalog, and a pass means the path callers take actually works.
  - `Math` is what makes that affordable: 23 tools needing neither authorization nor
    secrets, marked `read_only`, returning deterministic answers. `Math.Add` is the
    happy path, `Math.SumList` proves nested arguments survive the JSON boundary,
    and `Math.Divide` by zero is a genuine upstream failure. `src/testing.ts` holds
    the shared fixtures.
  - `fileParallelism` and `isolate` are both off: PGlite's lock means one process,
    one handle, one module registry for the whole run.
  - `NODE_OPTIONS` rejects `--env-file-if-exists`, so the script invokes vitest's
    entry through `node` directly to keep the repo's .env convention.
- `pnpm --filter @repo/api smoke` drives every route in one pass against the live
  API. Same key requirement; it is a script, not a test.

## Scripts (`packages/api`)

Users write TypeScript against the catalog's types, validate it without running it,
and execute it in a sandbox. `GET /api/types` → `POST /api/validate` →
`PUT /api/scripts/:name` → `POST /api/scripts/:name/run`.

- **A script is not a module.** An author submits a contract as JSON Schema plus one
  `async run(input, { github, log }) { … }` method as text; `src/assemble.ts` builds
  the `defineScript({ … })` module that gets checked. Two things follow. Everything
  the script needs is *ambient* (`src/codegen.ts` emits a global declaration file,
  not `declare module`), so `src/policy.ts` rejects **every** import rather than
  allow-listing one. And reading a script back is a plain database read — the
  submitted schemas are stored verbatim, so nothing is re-derived from source.
- The table stores the request body plus the two things validation found that the
  body does not contain: `toolGrant`, which takes a parse of `run` to recover, and
  `snapshotId`. The assembled module, the contract IR and the toolkit namespaces are
  all pure functions of those, so they are rebuilt on demand rather than kept where
  they could drift — `contractFrom` runs on the write path *and* the run path, so a
  live run enforces a contract derived exactly like the one that type-checked.
  `compiled` is the one deliberate cache, because it is the artifact that executes
  and pinning it means the bytes that run are the bytes that were checked.
- One `grant`, and it is a map: `{"github.getIssue": "Github.GetIssue"}`. The
  sandbox builds the guest's tool surface from it and the authorization pre-flight
  reads `Object.values`, so a parallel array of upstream names would just be a lossy
  view of the same column.
- Splicing text into generated code is a template injection: a `run` value that
  closes its own method early would leave statements at the module's top level.
  `checkAssembly` requires the assembled file to be exactly one `defineScript` call,
  and the policy pass runs over the assembled module, so an escape fails twice.
- Diagnostics come back in the author's coordinates. `toAuthorCoordinates` subtracts
  the generated preamble's line count; `run` is spliced at column 1 so columns need
  no adjustment. Anything landing *in* the preamble is re-reported as a `contract`
  error, because those lines are ours.

- **Arcade's `ValueSchema` is richer than the SDK says.** The wire format carries
  `properties`, `required_keys`, `inner_properties`, `inner_required_keys`,
  `nullable` and `description`, nested up to five deep; `@arcadeai/arcadejs`
  declares only `val_type | enum | inner_val_type`. `src/value-schema.ts` owns the
  real shape and the table's JSONB columns are typed against it — do not go back to
  `ToolDefinition`.
- Arrays of objects put their element shape on **`inner_properties`**, not
  `properties`. Missing that silently degrades a typed tool to `unknown`.
- `required_keys: []` beside a populated `properties` is ambiguous upstream
  (Github does it, Apollo doesn't), so `requiredKeys()` reads it as *unknown*
  requiredness and every field is emitted optional. That is why `issue.title` is
  `string | undefined` and scripts need `?? fallback`. Flipping this to "all
  required" is a one-line change and an unsound one.
- **Names are derived once over the whole catalog** (`src/catalog.ts` →
  `buildNameMap`), never over a filtered subset: collisions resolve against
  everything present, so a per-request map would hand the same tool different
  identifiers depending on the filter, and stored grants would drift. All 8196
  tools across 123 toolkits currently map without a single collision.
- **Two different things, deliberately kept apart.** The request body's `toolkits`
  says which toolkits are *in scope* — it scopes codegen and becomes the properties
  of `run`'s context. The **grant** is which tools the script may actually call, and
  that still comes from syntax: the `toolkit.method(...)` calls it makes.
  `src/policy.ts` enforces the rules that keep that extraction sound — a toolkit
  binding may *only* be the object of a direct method call, so aliasing, computed
  access and passing it around are all errors. Relax those and the grant stops
  meaning anything.
- Granting per toolkit instead would cost least privilege, and measurably: Gmail's
  30 tools span 7 distinct OAuth scopes, so `toolkits: ["gmail"]` alone would have
  to request read *and* send *and* compose for a script that only lists. Deriving
  the grant from the calls means a script that only calls `gmail.listEmails` is
  authorized for `gmail.readonly` and nothing else. That is what "scopes are
  implicit" buys — nobody declares a scope, and nobody over-grants either.
- The body and the code cannot disagree: the context type has exactly the declared
  toolkits, so destructuring an undeclared one is a type error, and declaring one
  that is never called is a `contract/unused-toolkit` warning.
- Scripts may **annotate with types but not declare them** (no type aliases,
  interfaces, conditional or mapped types). This isn't style: the checker runs in
  our process on untrusted input, and recursive type computation is a compile bomb.
  Removing the capability is why validation doesn't need a worker — which matters
  because the frontend bundles this package and can't spawn a `.ts` worker.
- `Spec` (`src/schema-dsl.ts`) is the one intermediate shape: a script's JSON Schema
  converts into it (`src/json-schema.ts`) and so does the catalog's `ValueSchema`, so
  a single validator covers the declared contract, the arguments leaving the sandbox
  and the results coming back. `specToSource` renders it back to `z.…` for the
  assembled module, which is why there is one validation path rather than two.
- `z` is a deliberately small Zod-shaped subset, not Zod: Zod's declarations would
  dominate the cost of type-checking a twenty-line script. The guest's `z` is an
  inert stub, because the contract was already read before anything ran and every
  check happens host-side.
- **Nothing writes to `scripts` except the validate-then-store path**, so the table
  holds an invariant: every row type-checks against its snapshot. There is no
  `invalid` state — only `stale`, when a later sync moves the catalog. That's what
  `POST /api/revalidate` reports. Writes are an upsert on `name`, which is the key
  authors already have. `id` also resolves on those routes, because the list
  response and every run record carry it — script names exclude `_` and ids are
  `scr_…`, so the two namespaces cannot collide and one path parameter serves both.
- The sandbox (`src/sandbox.ts`) is QuickJS-on-WASM via the **`sync`** variant, not
  `asyncify`: an asyncified module can only suspend for one host call at a time
  across every context inside it, which would serialise concurrent runs. Host calls
  go through `newFunction` + `newPromise` instead.
  - The guarantee is *no capability the guest wasn't handed*, not "QuickJS is
    unescapable". A fresh context has ECMAScript builtins and nothing else — no
    `fetch`, `require`, `process`, timers or I/O. The tool bridge is generated from
    the stored grant, so an ungranted tool isn't merely rejected, it doesn't exist
    as a property.
  - Values cross as JSON strings only. No live objects, no functions, no proxies.
  - `setInterruptHandler` bounds guest bytecode but **cannot preempt a pending host
    call**, so `callTool` races the same deadline itself. Both are load-bearing.
  - Host error messages reach guest `catch` verbatim; construct them deliberately.
  - Dispose the context only — its runtime is an owned lifetime.
- Tools execute as a named end user (`userId`), never as the deployment. The API key
  never enters a script, so even a total escape is bounded by what that user could
  already do through Arcade directly.
- A catalog-declared output shape is **descriptive**: a mismatch is recorded as
  `drift`, not a failure, because a vendor adding a field must not break scripts.
- Where the catalog says nothing the result is `unknown`, and narrowing it is the
  author's job, done in the code: `z.object({ … }).parse(result)`. That check runs
  **in the guest**, because it only protects the script from its own assumption —
  which is why the sandbox's `z` is a real validator rather than a stub. `input` and
  `output` are the contract with the caller and stay enforced host-side regardless
  of what the script does.
- There is no dry-run mode and no schema-derived fake data. Generating a plausible
  value from a declared shape only proves the shape was declared, and it diverges
  from what the tool really returns exactly where it would matter. Exercise a script
  by running it; `metadata.behavior.read_only` is how you tell which tools are safe
  to point it at.
- Coverage is the thing to watch: curated toolkits are ~70% typed, the 7038
  OpenAPI-generated `*Api` tools are 0%. `GET /api/coverage` is the list, and the
  fix is upstream in the toolkit definitions rather than schema inference here.

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
