import { Scalar } from "@scalar/hono-api-reference"
import { asc, count, desc, eq, inArray, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { agentHandler } from "./agent"
import {
  authorizationFor,
  type Catalog,
  coverage,
  loadCatalog,
} from "./catalog"
import { generateTypes } from "./codegen"
import { db } from "./db"
import { revalidateAll, runScript, upsertScript } from "./execute"
import { mcpHandler } from "./mcp"
import { openApiDocument } from "./openapi"
import { type ScriptRow, scripts, tools } from "./schema"
import {
  CoverageResponseSchema,
  ErrorResponseSchema,
  RevalidateResponseSchema,
  RunReportSchema,
  RunRequestSchema,
  ScriptParamsSchema,
  ScriptSchema,
  ScriptsResponseSchema,
  SeedResponseSchema,
  ToolkitsResponseSchema,
  ToolsQuerySchema,
  ToolsResponseSchema,
  TypesQuerySchema,
  UpsertScriptSchema,
  ValidationSchema,
} from "./schemas"
import { syncTools } from "./sync"
import { validateScript } from "./validate"

// Hosts need this to shut the database down cleanly; see ./db.
export { closeDb, DATA_DIR } from "./db"

/**
 * Lowercase letters, digits and dashes. Deliberately excludes `_`, which keeps
 * names disjoint from the `scr_…` id space so one path parameter can accept either.
 */
const SCRIPT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

const json = (schema: Parameters<typeof resolver>[0], description: string) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
})

/**
 * `:name` on every script route, declared rather than left to hono-openapi's
 * inference so that it carries a description. That description is also what an MCP
 * client sees for the argument, since ./mcp generates the tools from this document.
 */
const scriptName: Parameters<typeof describeRoute>[0]["parameters"] = [
  {
    in: "path",
    name: "name",
    required: true,
    schema: { type: "string" },
    description: "Script name, or its `scr_…` id.",
  },
]

/**
 * Treat an absent JSON body as `{}` so validation can say what is actually missing.
 *
 * Hono rejects an empty body with "Malformed JSON in request body", which sends you
 * looking for a syntax error in a request that has no syntax. Substituting an empty
 * object gets the real answer instead — `userId: expected string, received
 * undefined` — and cannot mask a genuine parse error, because a non-empty body is
 * still parsed normally.
 */
const emptyBodyIsEmptyObject = createMiddleware(async (c, next) => {
  const isJson = c.req.header("content-type")?.includes("application/json")
  if (isJson && (await c.req.raw.clone().text()).trim() === "") {
    // Built from primitives rather than `new Request(c.req.raw, …)`: undici rejects
    // re-wrapping one of its own Requests with "Cannot read private member #state".
    c.req.raw = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: "{}",
    })
  }
  await next()
})

/**
 * Routes are chained off a single `new Hono()` so `typeof routes` carries every
 * endpoint — that inferred type is what the RPC client consumes.
 */
export const routes = new Hono()
  .use(emptyBodyIsEmptyObject)
  .post(
    "/seed",
    describeRoute({
      // Every `operationId` here is also an MCP tool name, snake_cased — see ./mcp.
      // Omitting one still yields a tool, just under hono-openapi's generated id.
      operationId: "seed",
      summary: "Seed the database",
      description:
        "Paginates the full Arcade tool catalog and mirrors it into the local PGlite database. " +
        "Idempotent: rows upsert on their primary key and rows absent upstream are swept, so " +
        "repeated calls converge on the same state.",
      tags: ["seed"],
      responses: {
        200: json(SeedResponseSchema, "Sync completed."),
        502: json(
          ErrorResponseSchema,
          "The upstream Arcade API could not be reached."
        ),
      },
    }),
    async (c) => {
      try {
        return c.json(await syncTools(), 200)
      } catch (err) {
        return c.json(
          {
            error: "upstream_failed",
            message: err instanceof Error ? err.message : String(err),
          },
          502
        )
      }
    }
  )
  .get(
    "/toolkits",
    describeRoute({
      operationId: "listToolkits",
      summary: "List toolkits",
      description:
        "Every distinct toolkit in the database, with its tool count, busiest first.",
      tags: ["tools"],
      responses: {
        200: json(
          ToolkitsResponseSchema,
          "The toolkits present in the database."
        ),
      },
    }),
    async (c) => {
      const rows = await db
        .select({
          name: tools.toolkitName,
          // Descriptions/versions are per-tool upstream but constant per toolkit
          // in practice; max() picks one deterministically instead of grouping by it.
          description: sql<string | null>`max(${tools.toolkitDescription})`,
          version: sql<string | null>`max(${tools.toolkitVersion})`,
          toolCount: count().mapWith(Number),
        })
        .from(tools)
        .groupBy(tools.toolkitName)
        .orderBy(desc(count()), asc(tools.toolkitName))

      return c.json({ total: rows.length, toolkits: rows }, 200)
    }
  )
  .get(
    "/tools",
    describeRoute({
      operationId: "listTools",
      summary: "List tools",
      description:
        "Tools in the database, optionally narrowed to one or more toolkits. " +
        "Pass `toolkit` repeatedly or comma-separated; omit it to list everything.",
      tags: ["tools"],
      responses: {
        200: json(ToolsResponseSchema, "A page of tools."),
        400: json(ErrorResponseSchema, "Invalid query parameters."),
      },
    }),
    validator("query", ToolsQuerySchema),
    async (c) => {
      const { toolkit, limit, offset } = c.req.valid("query")
      const where = toolkit?.length
        ? inArray(tools.toolkitName, toolkit)
        : undefined

      const [rows, totals] = await Promise.all([
        db
          .select({
            fullyQualifiedName: tools.fullyQualifiedName,
            name: tools.name,
            qualifiedName: tools.qualifiedName,
            description: tools.description,
            toolkitName: tools.toolkitName,
            toolkitVersion: tools.toolkitVersion,
            input: tools.input,
            output: tools.output,
            requirements: tools.requirements,
            metadata: tools.metadata,
          })
          .from(tools)
          .where(where)
          .orderBy(asc(tools.toolkitName), asc(tools.name))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count().mapWith(Number) })
          .from(tools)
          .where(where),
      ])

      return c.json(
        {
          total: totals[0]?.total ?? 0,
          limit,
          offset,
          toolkits: toolkit ?? null,
          tools: rows,
        },
        200
      )
    }
  )
  .get(
    "/types",
    describeRoute({
      operationId: "getTypes",
      summary: "TypeScript declarations for the catalog",
      description:
        "The ambient declarations scripts are written against: one method per tool, with its " +
        "parameters typed from the catalog and its result typed where the catalog declares a shape, " +
        "plus `z` and `defineScript`. Everything is ambient, so a script imports nothing. " +
        "Filter with `toolkit` — the whole catalog is several megabytes. Pass the same toolkits " +
        "your script declares and this is byte-identical to what validation compiles " +
        "against, so what you read is what gets checked; order and repeats make no difference, " +
        "since the emitted file is sorted by namespace either way.",
      tags: ["scripts"],
      responses: {
        200: {
          description: "A TypeScript declaration file.",
          content: { "text/plain": { schema: { type: "string" } } },
        },
      },
    }),
    validator("query", TypesQuerySchema),
    async (c) => {
      const { toolkit } = c.req.valid("query")
      const catalog = await loadCatalog()

      const wanted = toolkit?.length
        ? toolkit.flatMap((name) => {
            const lower = name.toLowerCase()
            // Accept either the toolkit's upstream name or its script namespace.
            const match = [...catalog.nameMap.namespaces].find(
              ([namespace, entry]) =>
                namespace.toLowerCase() === lower ||
                entry.toolkitName.toLowerCase() === lower
            )
            return match ? (catalog.byNamespace.get(match[0]) ?? []) : []
          })
        : catalog.rows

      const generated = generateTypes(wanted, catalog.nameMap)
      c.header("Content-Type", "text/plain; charset=utf-8")
      c.header("X-Catalog-Snapshot", catalog.snapshotId)
      return c.body(generated.source, 200)
    }
  )
  .get(
    "/coverage",
    describeRoute({
      operationId: "getCoverage",
      summary: "Output-schema coverage per toolkit",
      description:
        "Which toolkits declare result shapes and which return `unknown`. Arcade's schema format " +
        "supports nested output types, but most toolkits do not populate them — and the fix is " +
        "upstream in the toolkit definitions, so this is the list that says where to start.",
      tags: ["scripts"],
      responses: {
        200: json(
          CoverageResponseSchema,
          "Coverage, best-covered toolkits first."
        ),
      },
    }),
    async (c) => {
      const [report, catalog] = await Promise.all([coverage(), loadCatalog()])
      return c.json({ snapshotId: catalog.snapshotId, ...report }, 200)
    }
  )
  .post(
    "/validate",
    describeRoute({
      operationId: "validateScript",
      summary: "Validate a script without running it",
      description:
        "Checks a script against the catalog: the submitted contract, the capability grant read off " +
        "`run`'s destructured context parameter, and the type checker. Nothing is stored and nothing " +
        "executes, so this is the loop to iterate in. Diagnostic line numbers refer to your `run` text. " +
        "`ok: true` means the script conforms to its contract — not that it is safe to run, which is " +
        "the sandbox's job.",
      tags: ["scripts"],
      responses: {
        200: json(ValidationSchema, "The verdict, with diagnostics."),
      },
    }),
    validator("json", ScriptParamsSchema),
    async (c) => {
      const {
        contract: _contract,
        namespaces,
        ...rest
      } = await validateScript(c.req.valid("json"))
      const result = { ...rest, toolkits: namespaces }
      // `source` rides along: it is the module that was checked, and the only place
      // to see it — a stored script keeps its parts, not the assembly.
      return c.json(result, 200)
    }
  )
  .put(
    "/scripts/:name",
    describeRoute({
      operationId: "upsertScript",
      summary: "Create or replace a script",
      parameters: scriptName,
      description:
        "Validates, then stores. An invalid script never lands, so every row in the table type-checks " +
        "against its catalog snapshot — the runner never has to ask whether a script is coherent. " +
        "Idempotent on `name`: writing the same name again replaces it and bumps `version`. " +
        "Include reasonable `default`s on the input schema's properties — the run UI seeds its " +
        "payload from them.",
      tags: ["scripts"],
      responses: {
        200: json(ScriptSchema, "Replaced an existing script."),
        201: json(ScriptSchema, "Stored a new script."),
        400: json(ErrorResponseSchema, "The name is not a valid script name."),
        422: json(
          ValidationSchema,
          "The script did not validate; nothing was stored."
        ),
      },
    }),
    validator("json", UpsertScriptSchema),
    async (c) => {
      const name = c.req.param("name")
      if (!SCRIPT_NAME.test(name)) {
        return c.json(
          {
            error: "invalid_name",
            message:
              "A script name is lowercase letters, digits and dashes — no underscores, so it can never collide with an `scr_…` id.",
          },
          400
        )
      }

      const { description, ...params } = c.req.valid("json")
      const result = await upsertScript({
        name,
        description,
        params,
      })
      if (!result.ok) return c.json(result.validation, 422)
      return c.json(await present(result.script), result.created ? 201 : 200)
    }
  )
  .get(
    "/scripts",
    describeRoute({
      operationId: "listScripts",
      summary: "List scripts",
      tags: ["scripts"],
      responses: { 200: json(ScriptsResponseSchema, "Every stored script.") },
    }),
    async (c) => {
      const [rows, catalog] = await Promise.all([
        db.select().from(scripts).orderBy(asc(scripts.name)),
        loadCatalog(),
      ])
      return c.json(
        {
          total: rows.length,
          snapshotId: catalog.snapshotId,
          scripts: rows.map((row) => describeScript(row, catalog)),
        },
        200
      )
    }
  )
  .get(
    "/scripts/:name",
    describeRoute({
      operationId: "getScript",
      summary: "Read a script",
      parameters: scriptName,
      description:
        "Everything that went in: the `run` method and the `input`/`output` schemas exactly " +
        "as submitted, plus the derived grant. Straight out of the database — nothing is re-derived, " +
        "and nothing is stored that the request body did not carry.",
      tags: ["scripts"],
      responses: {
        200: json(ScriptSchema, "The script."),
        404: json(ErrorResponseSchema, "No such script."),
      },
    }),
    async (c) => {
      const row = await findScript(c.req.param("name"))
      if (!row)
        return c.json({ error: "not_found", message: "No such script." }, 404)
      return c.json(await present(row), 200)
    }
  )
  .delete(
    "/scripts/:name",
    describeRoute({
      operationId: "deleteScript",
      summary: "Delete a script",
      parameters: scriptName,
      tags: ["scripts"],
      responses: {
        200: json(z.object({ deleted: z.string() }), "Deleted."),
        404: json(ErrorResponseSchema, "No such script."),
      },
    }),
    async (c) => {
      const key = c.req.param("name")
      const [deleted] = await db
        .delete(scripts)
        .where(or(eq(scripts.name, key), eq(scripts.id, key)))
        .returning({ id: scripts.id })
      if (!deleted)
        return c.json({ error: "not_found", message: "No such script." }, 404)
      return c.json({ deleted: deleted.id }, 200)
    }
  )
  .post(
    "/scripts/:name/run",
    describeRoute({
      operationId: "runScript",
      summary: "Run a script",
      parameters: scriptName,
      description:
        "Executes inside QuickJS-on-WASM with no globals but `log` and the tools in the script's stored " +
        "grant. Tools run as `userId`, so a run can only reach what that user has already authorized. " +
        "A failed run still returns the full report — outcome, logs, tool calls.",
      tags: ["scripts"],
      responses: {
        200: json(RunReportSchema, "The script ran to completion."),
        400: json(
          RunReportSchema,
          "The input did not match the script's declared `input` schema."
        ),
        404: json(ErrorResponseSchema, "No such script."),
        409: json(
          RunReportSchema,
          "The user has not authorized every tool in the grant."
        ),
        422: json(
          RunReportSchema,
          "The script returned something its `output` schema rejects."
        ),
        500: json(RunReportSchema, "The script or one of its tools failed."),
        504: json(
          RunReportSchema,
          "A limit was exceeded — time, memory, tool calls or output size."
        ),
      },
    }),
    validator("json", RunRequestSchema),
    async (c) => {
      const script = await findScript(c.req.param("name"))
      if (!script)
        return c.json({ error: "not_found", message: "No such script." }, 404)

      const { input, userId } = c.req.valid("json")
      const report = await runScript({ script, input: input ?? {}, userId })

      // The outcome union is the real answer; the status is a lossy summary of it.
      const status = (
        {
          ok: 200,
          input_invalid: 400,
          authorization_required: 409,
          contract_violation: 422,
          script_error: 500,
          tool_error: 500,
          limit_exceeded: 504,
        } as const
      )[report.outcome.kind]

      return c.json(report, status)
    }
  )
  .post(
    "/revalidate",
    describeRoute({
      operationId: "revalidate",
      summary: "Re-check every script against the current catalog",
      description:
        "Pure and cheap, because validation executes nothing. Run this after seeding to find " +
        "out which scripts a catalog change broke.",
      tags: ["scripts"],
      responses: {
        200: json(
          RevalidateResponseSchema,
          "What still validates and what does not."
        ),
      },
    }),
    async (c) => c.json(await revalidateAll(), 200)
  )

/** Scripts are addressed by name; `id` stays internal, for run records to point at. */
/**
 * A script is addressed by name, but `id` is what run records carry and what the
 * list response shows, so both resolve here.
 *
 * There is no ambiguity to resolve between them: {@link SCRIPT_NAME} forbids
 * underscores and ids are always `scr_…`, so the two namespaces cannot overlap.
 */
async function findScript(key: string) {
  const [row] = await db
    .select()
    .from(scripts)
    .where(or(eq(scripts.name, key), eq(scripts.id, key)))
  return row
}

function describeScript(row: ScriptRow, catalog: Catalog) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    run: row.run,
    input: row.inputSchema,
    output: row.outputSchema,
    version: row.version,
    grant: row.toolGrant,
    toolkits: row.toolkits,
    authorization: authorizationFor(
      { toolkits: row.toolkits, grant: row.toolGrant },
      catalog
    ),
    snapshotId: row.snapshotId,
    stale: row.snapshotId !== catalog.snapshotId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const present = async (row: ScriptRow) =>
  describeScript(row, await loadCatalog())

/**
 * Everything this package exposes lives under `/api`, and that prefix is part of
 * the app rather than something a host adds: the standalone server and the
 * frontend then serve identical URLs, and the generated document describes the
 * paths callers actually use.
 *
 * `routes` stays unprefixed so the RPC client's base URL carries the `/api` —
 * `createClient("/api").tools.$get()` rather than `client.api.tools.$get()`.
 */
export const app = new Hono()
  .route("/api", routes)
  // A UI message stream, not a catalog operation — see ./agent. Tools come from
  // `/api/mcp` via createMCPClient, so the agent and every other MCP client share
  // one derived list.
  .post("/api/chat", agentHandler)
  .all(
    "/api/mcp",
    mcpHandler({
      // The whole API, as MCP tools, generated from the document rather than
      // listed here — see ./mcp.
      document: () => document(),
      // Documented paths carry the `/api` this app owns; `routes` sits under it.
      request: (path, init) => routes.request(path.slice("/api".length), init),
    })
  )
  .get("/api/openapi", async (c) => c.json(await document()))
  .get(
    "/api/scalar",
    Scalar({ url: "/api/openapi", pageTitle: "Arcade Tools Mirror" })
  )

const document = openApiDocument(app, {
  documentation: {
    info: {
      title: "Arcade Tools Mirror",
      version: "1.0.0",
      description:
        "A local mirror of the Arcade tool catalog, stored in PGlite via Drizzle. " +
        "`POST /api/seed` populates it; the read endpoints query it.",
    },
    tags: [
      { name: "seed", description: "Populate the mirror from the Arcade API." },
      { name: "tools", description: "Read the mirrored catalog." },
      {
        name: "scripts",
        description:
          "Write, validate and run code against the catalog's types. Validation executes nothing; " +
          "execution happens in a WASM sandbox holding no capability beyond the script's tool grant.",
      },
    ],
  },
})

/** The type the RPC client is built from. */
export type AppType = typeof routes

export default app
