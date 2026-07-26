import type { ToolDefinition } from "@arcadeai/arcadejs/resources/tools/tools";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ToolInput, ToolOutput } from "./value-schema";

export const tools = pgTable(
  "tools",
  {
    fullyQualifiedName: text("fully_qualified_name").primaryKey(),
    name: text("name").notNull(),
    qualifiedName: text("qualified_name").notNull(),
    description: text("description"),
    toolkitName: text("toolkit_name").notNull(),
    toolkitDescription: text("toolkit_description"),
    toolkitVersion: text("toolkit_version"),
    // Typed against ./value-schema rather than the SDK: `ToolDefinition`'s
    // `ValueSchema` omits `properties`, `required_keys`, `inner_properties`,
    // `nullable` and `description`, all of which the API sends and codegen needs.
    input: jsonb("input").$type<ToolInput>(),
    output: jsonb("output").$type<ToolOutput>(),
    requirements: jsonb("requirements").$type<ToolDefinition["requirements"]>(),
    metadata: jsonb("metadata").$type<ToolDefinition["metadata"]>(),
    formattedSchema: jsonb("formatted_schema").$type<ToolDefinition["formatted_schema"]>(),
    raw: jsonb("raw").$type<ToolDefinition>().notNull(),
    /**
     * Stamped with the current run's start time on every upsert. Rows left with an
     * older stamp after a full sync no longer exist upstream and get swept.
     */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("tools_toolkit_name_idx").on(t.toolkitName), index("tools_name_idx").on(t.name)],
);

export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;

/**
 * Stored scripts.
 *
 * Nothing writes here except the validate-then-store path, so the table holds an
 * invariant rather than just rows: **every script in it type-checks against its
 * catalog snapshot**. There is no `invalid` state to represent — a script can only
 * go *stale*, when a later sync changes the tools underneath it, which is why
 * `snapshotId` is recorded alongside the source.
 *
 * `toolGrant` and `contract` are derived from the source at write time and are what
 * the sandbox actually enforces at run time. Re-deriving them per run would mean
 * parsing untrusted source on the hot path; storing them means the capability set
 * is a column you can query and audit.
 */
export const scripts = pgTable("scripts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** The author's `async run(input, { … }) { … }` method, verbatim. */
  run: text("run").notNull(),
  /** JSON Schema for the run input, exactly as submitted. */
  inputSchema: jsonb("input_schema").$type<unknown>().notNull(),
  /** JSON Schema the return value must satisfy, exactly as submitted. */
  outputSchema: jsonb("output_schema").$type<unknown>().notNull(),
  /** Declared shapes for tools the catalog leaves unspecified, keyed by tool path. */
  expectSchemas: jsonb("expect_schemas").$type<Record<string, unknown>>().notNull().default({}),
  /**
   * The module assembled from the columns above. Derived, stored for auditability:
   * it is what actually type-checked.
   */
  source: text("source").notNull(),
  /** Type-erased source, ready for the sandbox. */
  compiled: text("compiled").notNull(),
  sourceHash: text("source_hash").notNull(),
  /** `github.getIssue` → `Github.GetIssue`: the runtime allowlist. */
  toolGrant: jsonb("tool_grant").$type<Record<string, string>>().notNull(),
  namespaces: jsonb("namespaces").$type<string[]>().notNull(),
  /** `input`, `output` and `expect` specs, read out of the source without running it. */
  contract: jsonb("contract").$type<unknown>().notNull(),
  /** The catalog this was validated against; a mismatch means "revalidate me". */
  snapshotId: text("snapshot_id").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type ScriptRow = typeof scripts.$inferSelect;

/** One execution. Written before the sandbox starts, so tool effects are never unrecorded. */
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    scriptId: text("script_id").notNull(),
    scriptVersion: integer("script_version").notNull(),
    /** The Arcade end user the run executed as. */
    userId: text("user_id").notNull(),
    input: jsonb("input").$type<unknown>(),
    /** Discriminated on `kind`; an HTTP status is a lossy summary of this. */
    outcome: jsonb("outcome").$type<unknown>(),
    logs: jsonb("logs").$type<string[]>(),
    toolCalls: jsonb("tool_calls").$type<unknown>(),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_script_id_idx").on(t.scriptId), index("runs_started_at_idx").on(t.startedAt)],
);

export type RunRow = typeof runs.$inferSelect;
