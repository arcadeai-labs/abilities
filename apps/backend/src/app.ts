import { Scalar } from "@scalar/hono-api-reference";
import { asc, count, desc, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { db, ensureMigrated } from "./db";
import { openApiDocument } from "./openapi";
import { tools } from "./schema";
import {
  ErrorResponseSchema,
  SeedResponseSchema,
  ToolkitsResponseSchema,
  ToolsQuerySchema,
  ToolsResponseSchema,
} from "./schemas";
import { syncTools } from "./sync";

const json = (schema: Parameters<typeof resolver>[0], description: string) => ({
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
      await ensureMigrated();
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
      await ensureMigrated();
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
  );

const document = openApiDocument(routes, {
  documentation: {
    info: {
      title: "Arcade Tools Mirror",
      version: "1.0.0",
      description:
        "A local mirror of the Arcade tool catalog, stored in PGlite via Drizzle. " +
        "`POST /seed` populates it; the read endpoints query it.",
    },
    servers: [{ url: "http://localhost:3000", description: "Local" }],
    tags: [
      { name: "seed", description: "Populate the mirror from the Arcade API." },
      { name: "tools", description: "Read the mirrored catalog." },
    ],
  },
});

export const app = new Hono()
  .route("/", routes)
  .get("/openapi", async (c) => c.json(await document()))
  .get("/scalar", Scalar({ url: "/openapi", pageTitle: "Arcade Tools Mirror" }));

/** The type the RPC client is built from. */
export type AppType = typeof routes;

export default app;
