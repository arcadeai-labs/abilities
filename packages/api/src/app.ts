import { Scalar } from "@scalar/hono-api-reference";
import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { coverage, loadCatalog } from "./catalog";
import { generateTypes } from "./codegen";
import { db } from "./db";
import { revalidateAll, runScript, storeScript } from "./execute";
import { openApiDocument } from "./openapi";
import { type ScriptRow, scripts, tools } from "./schema";
import {
  CoverageResponseSchema,
  CreateScriptSchema,
  ErrorResponseSchema,
  RevalidateResponseSchema,
  RunReportSchema,
  RunRequestSchema,
  ScriptSchema,
  ScriptsResponseSchema,
  SeedResponseSchema,
  ToolkitsResponseSchema,
  ToolsQuerySchema,
  ToolsResponseSchema,
  TypesQuerySchema,
  UpdateScriptSchema,
  ValidateRequestSchema,
  ValidationSchema,
} from "./schemas";
import { syncTools } from "./sync";
import { validateScript } from "./validate";

// Hosts need this to shut the database down cleanly; see ./db.
export { closeDb, DATA_DIR } from "./db";

const json =(schema: Parameters<typeof resolver>[0], description: string) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
});

/**
 * Routes are chained off a single `new Hono()` so `typeof routes` carries every
 * endpoint — that inferred type is what the RPC client consumes.
 */
export const routes = new Hono()
  .post(
    "/seed",
    describeRoute({
      summary: "Seed the database",
      description:
        "Paginates the full Arcade tool catalog and mirrors it into the local PGlite database. " +
        "Idempotent: rows upsert on their primary key and rows absent upstream are swept, so " +
        "repeated calls converge on the same state.",
      tags: ["seed"],
      responses: {
        200: json(SeedResponseSchema, "Sync completed."),
        502: json(ErrorResponseSchema, "The upstream Arcade API could not be reached."),
      },
    }),
    async (c) => {
      try {
        return c.json(await syncTools(), 200);
      } catch (err) {
        return c.json(
          { error: "upstream_failed", message: err instanceof Error ? err.message : String(err) },
          502,
        );
      }
    },
  )
  .get(
    "/toolkits",
    describeRoute({
      summary: "List toolkits",
      description: "Every distinct toolkit in the database, with its tool count, busiest first.",
      tags: ["tools"],
      responses: { 200: json(ToolkitsResponseSchema, "The toolkits present in the database.") },
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
        .orderBy(desc(count()), asc(tools.toolkitName));

      return c.json({ total: rows.length, toolkits: rows }, 200);
    },
  )
  .get(
    "/tools",
    describeRoute({
      summary: "List tools",
      description:
        "Tools in the database, optionally narrowed to one or more toolkits. " +
        "Pass `?toolkit=` repeatedly or comma-separated; omit it to list everything.",
      tags: ["tools"],
      responses: {
        200: json(ToolsResponseSchema, "A page of tools."),
        400: json(ErrorResponseSchema, "Invalid query parameters."),
      },
    }),
    validator("query", ToolsQuerySchema),
    async (c) => {
      const { toolkit, limit, offset } = c.req.valid("query");
      const where = toolkit?.length ? inArray(tools.toolkitName, toolkit) : undefined;

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
        db.select({ total: count().mapWith(Number) }).from(tools).where(where),
      ]);

      return c.json(
        { total: totals[0]?.total ?? 0, limit, offset, toolkits: toolkit ?? null, tools: rows },
        200,
      );
    },
  )
  .get(
    "/types",
    describeRoute({
      summary: "TypeScript declarations for the catalog",
      description:
        "The `arcade:runtime` module scripts are written against: one method per tool, with its " +
        "parameters typed from the catalog and its result typed where the catalog declares a shape. " +
        "This is byte-identical to what `POST /api/validate` compiles against, so what you read is " +
        "what gets checked. Filter with `?toolkit=` — the whole catalog is several megabytes.",
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
      const { toolkit } = c.req.valid("query");
      const catalog = await loadCatalog();

      const wanted = toolkit?.length
        ? toolkit.flatMap((name) => {
            const lower = name.toLowerCase();
            // Accept either the toolkit's upstream name or its script namespace.
            const match = [...catalog.nameMap.namespaces].find(
              ([namespace, entry]) =>
                namespace.toLowerCase() === lower || entry.toolkitName.toLowerCase() === lower,
            );
            return match ? (catalog.byNamespace.get(match[0]) ?? []) : [];
          })
        : catalog.rows;

      const generated = generateTypes(wanted, catalog.nameMap);
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("X-Catalog-Snapshot", catalog.snapshotId);
      return c.body(generated.source, 200);
    },
  )
  .get(
    "/coverage",
    describeRoute({
      summary: "Output-schema coverage per toolkit",
      description:
        "Which toolkits declare result shapes and which return `unknown`. Arcade's schema format " +
        "supports nested output types, but most toolkits do not populate them — and the fix is " +
        "upstream in the toolkit definitions, so this is the list that says where to start.",
      tags: ["scripts"],
      responses: { 200: json(CoverageResponseSchema, "Coverage, best-covered toolkits first.") },
    }),
    async (c) => {
      const [report, catalog] = await Promise.all([coverage(), loadCatalog()]);
      return c.json({ snapshotId: catalog.snapshotId, ...report }, 200);
    },
  )
  .post(
    "/validate",
    describeRoute({
      summary: "Validate a script without running it",
      description:
        "Checks a script against the catalog: syntax policy, the capability grant read off `run`'s " +
        "destructured context parameter, and the type checker. Nothing is stored and nothing executes, " +
        "so this is the loop to iterate in. `ok: true` means the script conforms to its contract — it " +
        "does not mean it is safe to run, which is the sandbox's job.",
      tags: ["scripts"],
      responses: { 200: json(ValidationSchema, "The verdict, with diagnostics.") },
    }),
    validator("json", ValidateRequestSchema),
    async (c) => {
      const { source } = c.req.valid("json");
      const { paths: _paths, contract: _contract, ...result } = await validateScript(source);
      return c.json(result, 200);
    },
  )
  .post(
    "/scripts",
    describeRoute({
      summary: "Store a script",
      description:
        "Validates, then stores. An invalid script never lands, so every row in the table type-checks " +
        "against its catalog snapshot — the runner never has to ask whether a script is coherent.",
      tags: ["scripts"],
      responses: {
        201: json(ScriptSchema, "Stored."),
        409: json(ErrorResponseSchema, "That name is taken."),
        422: json(ValidationSchema, "The script did not validate; nothing was stored."),
      },
    }),
    validator("json", CreateScriptSchema),
    async (c) => {
      const result = await storeScript(c.req.valid("json"));
      if ("conflict" in result) return c.json({ error: "name_taken", message: result.conflict }, 409);
      if (!result.ok) return c.json(result.validation, 422);
      return c.json(await present(result.script), 201);
    },
  )
  .get(
    "/scripts",
    describeRoute({
      summary: "List scripts",
      tags: ["scripts"],
      responses: { 200: json(ScriptsResponseSchema, "Every stored script.") },
    }),
    async (c) => {
      const [rows, catalog] = await Promise.all([
        db.select().from(scripts).orderBy(asc(scripts.name)),
        loadCatalog(),
      ]);
      return c.json(
        {
          total: rows.length,
          snapshotId: catalog.snapshotId,
          scripts: rows.map((row) => describeScript(row, catalog.snapshotId)),
        },
        200,
      );
    },
  )
  .get(
    "/scripts/:id",
    describeRoute({
      summary: "Read a script",
      tags: ["scripts"],
      responses: {
        200: json(ScriptSchema, "The script."),
        404: json(ErrorResponseSchema, "No such script."),
      },
    }),
    async (c) => {
      const row = await findScript(c.req.param("id"));
      if (!row) return c.json({ error: "not_found", message: "No such script." }, 404);
      return c.json(await present(row), 200);
    },
  )
  .put(
    "/scripts/:id",
    describeRoute({
      summary: "Replace a script's source",
      description: "Same gate as creating one: it validates or nothing changes.",
      tags: ["scripts"],
      responses: {
        200: json(ScriptSchema, "Updated; `version` is bumped."),
        404: json(ErrorResponseSchema, "No such script."),
        422: json(ValidationSchema, "The script did not validate; nothing changed."),
      },
    }),
    validator("json", UpdateScriptSchema),
    async (c) => {
      const row = await findScript(c.req.param("id"));
      if (!row) return c.json({ error: "not_found", message: "No such script." }, 404);

      const body = c.req.valid("json");
      const result = await storeScript({ ...body, name: row.name, replacing: row });
      if ("conflict" in result) return c.json({ error: "name_taken", message: result.conflict }, 409);
      if (!result.ok) return c.json(result.validation, 422);
      return c.json(await present(result.script), 200);
    },
  )
  .delete(
    "/scripts/:id",
    describeRoute({
      summary: "Delete a script",
      tags: ["scripts"],
      responses: {
        200: json(z.object({ deleted: z.string() }), "Deleted."),
        404: json(ErrorResponseSchema, "No such script."),
      },
    }),
    async (c) => {
      const [deleted] = await db
        .delete(scripts)
        .where(eq(scripts.id, c.req.param("id")))
        .returning({ id: scripts.id });
      if (!deleted) return c.json({ error: "not_found", message: "No such script." }, 404);
      return c.json({ deleted: deleted.id }, 200);
    },
  )
  .post(
    "/scripts/:id/run",
    describeRoute({
      summary: "Run a script",
      description:
        "Executes inside QuickJS-on-WASM with no globals but `log` and the tools in the script's stored " +
        "grant. Tools run as `userId`, so a run can only reach what that user has already authorized.",
      tags: ["scripts"],
      responses: {
        200: json(RunReportSchema, "The script ran to completion."),
        400: json(RunReportSchema, "The input did not match the script's declared `input` schema."),
        404: json(ErrorResponseSchema, "No such script."),
        409: json(RunReportSchema, "The user has not authorized every tool in the grant."),
        422: json(RunReportSchema, "The script returned something its `output` schema rejects."),
        500: json(RunReportSchema, "The script or one of its tools failed."),
        504: json(RunReportSchema, "A limit was exceeded — time, memory, tool calls or output size."),
      },
    }),
    validator("json", RunRequestSchema),
    async (c) => {
      const script = await findScript(c.req.param("id"));
      if (!script) return c.json({ error: "not_found", message: "No such script." }, 404);

      const { input, userId } = c.req.valid("json");
      const report = await runScript({ script, input, userId });

      // The outcome union is the real answer; the status is a lossy summary of it.
      const status = {
        ok: 200,
        input_invalid: 400,
        authorization_required: 409,
        contract_violation: 422,
        script_error: 500,
        tool_error: 500,
        limit_exceeded: 504,
      }[report.outcome.kind] as 200 | 400 | 409 | 422 | 500 | 504;

      return c.json(report, status);
    },
  )
  .post(
    "/revalidate",
    describeRoute({
      summary: "Re-check every script against the current catalog",
      description:
        "Pure and cheap, because validation executes nothing. Run this after `POST /api/seed` to find " +
        "out which scripts a catalog change broke.",
      tags: ["scripts"],
      responses: { 200: json(RevalidateResponseSchema, "What still validates and what does not.") },
    }),
    async (c) => c.json(await revalidateAll(), 200),
  );

async function findScript(id: string) {
  const [row] = await db.select().from(scripts).where(eq(scripts.id, id));
  return row;
}

function describeScript(row: ScriptRow, snapshotId: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    version: row.version,
    grant: [...new Set(Object.values(row.toolGrant))].sort(),
    namespaces: row.namespaces,
    snapshotId: row.snapshotId,
    stale: row.snapshotId !== snapshotId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const present = async (row: ScriptRow) => describeScript(row, (await loadCatalog()).snapshotId);

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
  .get("/api/openapi", async (c) => c.json(await document()))
  .get("/api/scalar", Scalar({ url: "/api/openapi", pageTitle: "Arcade Tools Mirror" }));

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
});


/** The type the RPC client is built from. */
export type AppType = typeof routes;

export default app;
