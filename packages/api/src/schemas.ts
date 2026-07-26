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

/** `?toolkit=Github,Slack` — same parsing as `ToolsQuerySchema`. */
const toolkitFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    v === undefined
      ? undefined
      : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean),
  );

export const TypesQuerySchema = z.object({
  toolkit: toolkitFilter.describe(
    "Toolkit name(s) to emit declarations for. Omit to emit the whole catalog, which is large.",
  ),
});

export const CoverageResponseSchema = z
  .object({
    snapshotId: z.string(),
    totals: z.object({ toolkits: z.int(), tools: z.int(), typed: z.int() }),
    curated: z
      .object({ toolkits: z.int(), tools: z.int(), typed: z.int() })
      .describe("Hand-authored toolkits."),
    generated: z
      .object({ toolkits: z.int(), tools: z.int(), typed: z.int() })
      .describe("Toolkits generated from OpenAPI specs, which declare no output shapes."),
    toolkits: z.array(
      z.object({
        toolkit: z.string(),
        namespace: z.string().describe("How the toolkit is named in a script."),
        tools: z.int(),
        typed: z.int().describe("Tools declaring an output shape."),
        generated: z.boolean(),
      }),
    ),
  })
  .meta({ id: "CoverageResponse" });

export const DiagnosticSchema = z
  .object({
    category: z
      .enum(["policy", "type", "contract"])
      .describe("`policy` from the syntax rules, `type` from the compiler, `contract` from the schemas."),
    code: z.string().describe("`TS2322`, `policy/no-eval`, …"),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
    start: z.object({ line: z.int(), column: z.int() }),
    end: z.object({ line: z.int(), column: z.int() }),
  })
  .meta({ id: "Diagnostic" });

export const ValidationSchema = z
  .object({
    ok: z.boolean(),
    snapshotId: z.string().describe("The catalog snapshot this was checked against."),
    diagnostics: z.array(DiagnosticSchema),
    namespaces: z.array(z.string()).describe("Toolkits the script destructured."),
    grant: z
      .record(z.string(), z.string())
      .describe("`github.getIssue` to `Github.GetIssue` — every tool this script may call."),
    source: z.string().nullable().describe("The module that was checked, assembled from the parts."),
    outputCoverage: z.array(
      z.object({
        path: z.string(),
        qualifiedName: z.string(),
        typed: z.boolean().describe("False means the result is `unknown` and needs `expect`."),
      }),
    ),
  })
  .meta({ id: "Validation" });

const JsonSchemaSchema = z
  .record(z.string(), z.unknown())
  .describe("A JSON Schema. Supported: type, enum, const, properties, required, items, additionalProperties, format, pattern, min/max, nullable.");

export const ScriptParamsSchema = z
  .object({
    input: JsonSchemaSchema.describe("Shape of the value `run` receives."),
    output: JsonSchemaSchema.describe("Shape the return value must satisfy."),
    expect: z
      .record(z.string(), JsonSchemaSchema)
      .optional()
      .describe(
        "Shapes for tools whose catalog output is unspecified, keyed by tool path (`slack.sendMessage`). " +
          "Unlike a catalog shape this is an assertion, so a mismatch fails the run.",
      ),
    run: z
      .string()
      .describe(
        "The method source, starting `async run(input, { ... })`. Destructuring the second " +
          "parameter is what grants tool access. A script imports nothing.",
      ),
  })
  .meta({ id: "ScriptParams" });

export const UpsertScriptSchema = ScriptParamsSchema.extend({
  description: z.string().max(500).optional(),
}).meta({ id: "UpsertScript" });

export const ScriptSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    run: z.string().describe("The method source, as submitted."),
    input: z.unknown().describe("JSON Schema, as submitted."),
    output: z.unknown().describe("JSON Schema, as submitted."),
    expect: z.record(z.string(), z.unknown()).describe("JSON Schemas by tool path, as submitted."),
    version: z.int(),
    grant: z.array(z.string()).describe("Upstream tools this script may call."),
    paths: z.record(z.string(), z.string()).describe("`github.getIssue` to `Github.GetIssue`."),
    namespaces: z.array(z.string()),
    source: z.string().describe("The module assembled from the fields above; what type-checked."),
    snapshotId: z.string(),
    stale: z.boolean().describe("True when the catalog moved on since this was validated."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "Script" });

export const ScriptsResponseSchema = z
  .object({ total: z.int(), snapshotId: z.string(), scripts: z.array(ScriptSchema) })
  .meta({ id: "ScriptsResponse" });

export const RunRequestSchema = z
  .object({
    input: z.unknown().describe("Validated against the script's declared `input` schema."),
    userId: z
      .string()
      .min(1)
      .describe("The Arcade end user to run as. Tools execute with that user's authorizations."),
  })
  .meta({ id: "RunRequest" });

export const RunReportSchema = z
  .object({
    runId: z.string(),
    outcome: z.unknown().describe("Discriminated on `kind`; the HTTP status summarises it."),
    logs: z.array(z.string()),
    toolCalls: z.array(
      z.object({
        path: z.string(),
        qualifiedName: z.string(),
        ok: z.boolean(),
        durationMs: z.int(),
        error: z.string().optional(),
      }),
    ),
    drift: z
      .array(z.object({ tool: z.string(), violations: z.array(z.object({ path: z.string(), message: z.string() })) }))
      .describe("Where a tool's real result contradicted the catalog's declared shape."),
    durationMs: z.int(),
  })
  .meta({ id: "RunReport" });

export const RevalidateResponseSchema = z
  .object({
    snapshotId: z.string(),
    checked: z.int(),
    stale: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        diagnostics: z.int(),
        firstError: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "RevalidateResponse" });
