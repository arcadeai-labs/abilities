import type { ToolDefinition } from "@arcadeai/arcadejs/resources/tools/tools";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
    input: jsonb("input").$type<ToolDefinition["input"]>(),
    output: jsonb("output").$type<ToolDefinition["output"]>(),
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
