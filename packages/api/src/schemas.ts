import { z } from "zod";

/** `?toolkit=Github&toolkit=Slack` or `?toolkit=Github,Slack` — both collapse to string[]. */
export const ToolsQuerySchema = z.object({
  toolkit: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean),
    )
    .describe("Optional toolkit name(s) to filter by. Repeatable or comma-separated."),
  limit: z.coerce.number().int().min(1).max(1000).default(100).describe("Max tools to return."),
  offset: z.coerce.number().int().min(0).default(0).describe("Number of tools to skip."),
});

export const ToolkitSchema = z
  .object({
    name: z.string().describe("Toolkit name, e.g. `GithubApi`."),
    description: z.string().nullable().describe("Toolkit description, if the upstream API supplied one."),
    version: z.string().nullable().describe("Toolkit version."),
    toolCount: z.int().describe("Number of tools belonging to this toolkit."),
  })
  .meta({ id: "Toolkit" });

export const ToolkitsResponseSchema = z
  .object({
    total: z.int().describe("Number of distinct toolkits."),
    toolkits: z.array(ToolkitSchema),
  })
  .meta({ id: "ToolkitsResponse" });

export const ToolSchema = z
  .object({
    fullyQualifiedName: z.string().describe("Unique tool identifier including version."),
    name: z.string(),
    qualifiedName: z.string(),
    description: z.string().nullable(),
    toolkitName: z.string(),
    toolkitVersion: z.string().nullable(),
    input: z.unknown().describe("Tool input schema (parameters)."),
    output: z.unknown().describe("Tool output schema."),
    requirements: z.unknown().describe("Auth and secret requirements."),
    metadata: z.unknown().describe("Behaviour and classification metadata."),
  })
  .meta({ id: "Tool" });

export const ToolsResponseSchema = z
  .object({
    total: z.int().describe("Total tools matching the filter, ignoring limit/offset."),
    limit: z.int(),
    offset: z.int(),
    toolkits: z.array(z.string()).nullable().describe("The toolkit filter that was applied, if any."),
    tools: z.array(ToolSchema),
  })
  .meta({ id: "ToolsResponse" });

export const SeedResponseSchema = z
  .object({
    fetched: z.int().describe("Tool records received across all pages."),
    unique: z.int().describe("Distinct tools after collapsing duplicates."),
    duplicates: z.int().describe("Records collapsed because a page repeated a tool."),
    swept: z.int().describe("Rows deleted because they no longer exist upstream."),
    totalCount: z.int().describe("`total_count` reported by the Arcade API."),
    pages: z.int().describe("Pages walked."),
    rows: z.int().describe("Row count in the table after the sync."),
    durationMs: z.int(),
  })
  .meta({ id: "SeedResponse" });

export const ErrorResponseSchema = z
  .object({ error: z.string(), message: z.string() })
  .meta({ id: "ErrorResponse" });
