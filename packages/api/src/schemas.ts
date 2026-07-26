import { z } from "zod"

/** `?toolkit=Github&toolkit=Slack` or `?toolkit=Github,Slack` — both collapse to string[]. */
export const ToolsQuerySchema = z.object({
  toolkit: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((s) => s.split(","))
            .map((s) => s.trim())
            .filter(Boolean)
    )
    .describe(
      "Optional toolkit name(s) to filter by. Repeatable or comma-separated."
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Max tools to return."),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of tools to skip."),
})

export const ToolkitSchema = z
  .object({
    name: z.string().describe("Toolkit name, e.g. `GithubApi`."),
    description: z
      .string()
      .nullable()
      .describe("Toolkit description, if the upstream API supplied one."),
    version: z.string().nullable().describe("Toolkit version."),
    toolCount: z.int().describe("Number of tools belonging to this toolkit."),
  })
  .meta({ id: "Toolkit" })

export const ToolkitsResponseSchema = z
  .object({
    total: z.int().describe("Number of distinct toolkits."),
    toolkits: z.array(ToolkitSchema),
  })
  .meta({ id: "ToolkitsResponse" })

export const ToolSchema = z
  .object({
    fullyQualifiedName: z
      .string()
      .describe("Unique tool identifier including version."),
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
  .meta({ id: "Tool" })

export const ToolsResponseSchema = z
  .object({
    total: z
      .int()
      .describe("Total tools matching the filter, ignoring limit/offset."),
    limit: z.int(),
    offset: z.int(),
    toolkits: z
      .array(z.string())
      .nullable()
      .describe("The toolkit filter that was applied, if any."),
    tools: z.array(ToolSchema),
  })
  .meta({ id: "ToolsResponse" })

export const SeedResponseSchema = z
  .object({
    fetched: z.int().describe("Tool records received across all pages."),
    unique: z.int().describe("Distinct tools after collapsing duplicates."),
    duplicates: z
      .int()
      .describe("Records collapsed because a page repeated a tool."),
    swept: z
      .int()
      .describe("Rows deleted because they no longer exist upstream."),
    totalCount: z.int().describe("`total_count` reported by the Arcade API."),
    pages: z.int().describe("Pages walked."),
    rows: z.int().describe("Row count in the table after the sync."),
    durationMs: z.int(),
  })
  .meta({ id: "SeedResponse" })

export const ErrorResponseSchema = z
  .object({ error: z.string(), message: z.string() })
  .meta({ id: "ErrorResponse" })

/** `?toolkit=Github,Slack` — same parsing as `ToolsQuerySchema`. */
const toolkitFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    v === undefined
      ? undefined
      : (Array.isArray(v) ? v : [v])
          .flatMap((s) => s.split(","))
          .map((s) => s.trim())
          .filter(Boolean)
  )

export const TypesQuerySchema = z.object({
  toolkit: toolkitFilter.describe(
    "Toolkit name(s) to emit declarations for. Omit to emit the whole catalog, which is large."
  ),
})

export const CoverageResponseSchema = z
  .object({
    snapshotId: z.string(),
    totals: z.object({ toolkits: z.int(), tools: z.int(), typed: z.int() }),
    curated: z
      .object({ toolkits: z.int(), tools: z.int(), typed: z.int() })
      .describe("Hand-authored toolkits."),
    generated: z
      .object({ toolkits: z.int(), tools: z.int(), typed: z.int() })
      .describe(
        "Toolkits generated from OpenAPI specs, which declare no output shapes."
      ),
    toolkits: z.array(
      z.object({
        toolkit: z.string(),
        namespace: z.string().describe("How the toolkit is named in a script."),
        tools: z.int(),
        typed: z.int().describe("Tools declaring an output shape."),
        generated: z.boolean(),
      })
    ),
  })
  .meta({ id: "CoverageResponse" })

export const DiagnosticSchema = z
  .object({
    category: z
      .enum(["policy", "type", "contract"])
      .describe(
        "`policy` from the syntax rules, `type` from the compiler, `contract` from the schemas."
      ),
    code: z.string().describe("`TS2322`, `policy/no-eval`, …"),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
    start: z.object({ line: z.int(), column: z.int() }),
    end: z.object({ line: z.int(), column: z.int() }),
  })
  .meta({ id: "Diagnostic" })

export const ValidationSchema = z
  .object({
    ok: z.boolean(),
    snapshotId: z
      .string()
      .describe("The catalog snapshot this was checked against."),
    diagnostics: z.array(DiagnosticSchema),
    toolkits: z
      .array(z.string())
      .describe("Toolkits put in scope, as declared."),
    grant: z
      .record(z.string(), z.string())
      .describe(
        "`github.getIssue` to `Github.GetIssue` — every tool this script may call."
      ),
    source: z
      .string()
      .nullable()
      .describe("The module that was checked, assembled from the parts."),
    outputCoverage: z.array(
      z.object({
        path: z.string(),
        qualifiedName: z.string(),
        typed: z
          .boolean()
          .describe(
            "False means the result arrives as `unknown`; narrow it with `z.….parse()`."
          ),
      })
    ),
  })
  .meta({ id: "Validation" })

const JsonSchemaSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "A JSON Schema. Supported: type, enum, const, properties, required, items, additionalProperties, format, pattern, min/max, nullable, default."
  )

export const ScriptParamsSchema = z
  .object({
    input: JsonSchemaSchema.describe(
      "Shape of the value `run` receives. Put a reasonable `default` on each property — the run UI " +
        "seeds its payload from those."
    ),
    output: JsonSchemaSchema.describe("Shape the return value must satisfy."),
    toolkits: z
      .array(z.string())
      .default([])
      .describe(
        'Toolkits to put in scope, by namespace — `["gmail", "linear"]`. These become the ' +
          "properties of `run`'s context object. Which tools within them the script may call, " +
          "and therefore which OAuth scopes are requested, follows from the calls it makes."
      ),
    run: z
      .string()
      .describe(
        "The method source, starting `async run(input, { ... })`. Destructuring the second " +
          "parameter is what grants tool access. A script imports nothing."
      ),
  })
  .meta({ id: "ScriptParams" })

export const UpsertScriptSchema = ScriptParamsSchema.extend({
  description: z.string().max(500).optional(),
}).meta({ id: "UpsertScript" })

export const ScriptSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    run: z.string().describe("The method source, as submitted."),
    input: z.unknown().describe("JSON Schema, as submitted."),
    output: z.unknown().describe("JSON Schema, as submitted."),
    version: z.int(),
    grant: z
      .record(z.string(), z.string())
      .describe(
        "`github.getIssue` to `Github.GetIssue` — every tool this script may call."
      ),
    toolkits: z
      .array(z.string())
      .describe("Toolkits put in scope, as submitted."),
    authorization: z
      .array(
        z.object({
          toolkit: z.string(),
          tools: z
            .array(z.string())
            .describe("Granted tools from this toolkit, by their script name."),
          scopes: z
            .array(z.string())
            .describe(
              "The OAuth scopes those tools need. Empty is not the same as `requiresAuth: false` — " +
                "some providers demand an account without declaring scopes per tool."
            ),
          requiresAuth: z
            .boolean()
            .describe(
              "Whether any granted tool here needs an authorized account."
            ),
        })
      )
      .describe(
        "What running this will ask the end user to authorize, per declared toolkit. " +
          "Derived from the grant against the current catalog, so a toolkit the script " +
          "never calls contributes nothing."
      ),
    snapshotId: z.string(),
    stale: z
      .boolean()
      .describe("True when the catalog moved on since this was validated."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "Script" })

export const ScriptsResponseSchema = z
  .object({
    total: z.int(),
    snapshotId: z.string(),
    scripts: z.array(ScriptSchema),
  })
  .meta({ id: "ScriptsResponse" })

export const RunRequestSchema = z
  .object({
    /**
     * Left untyped on purpose — the real shape is the script's own declared `input`,
     * which this is validated against. Optional so a script that takes nothing can
     * be run with just a `userId`, and given an example so tooling has something to
     * put in the box: an untyped *required* property is one a generated client
     * cannot fill, which ends up sending no body at all.
     */
    input: z
      .unknown()
      .optional()
      .meta({ examples: [{}] })
      .describe(
        "Validated against the script's declared `input` schema. Defaults to `{}`."
      ),
    userId: z
      .string()
      .min(1)
      .describe(
        "The Arcade end user to run as. Tools execute with that user's authorizations."
      ),
  })
  .meta({ id: "RunRequest" })

export const RunReportSchema = z
  .object({
    runId: z.string(),
    outcome: z
      .unknown()
      .describe("Discriminated on `kind`; the HTTP status summarises it."),
    logs: z.array(z.string()),
    toolCalls: z.array(
      z.object({
        path: z.string(),
        qualifiedName: z.string(),
        ok: z.boolean(),
        durationMs: z.int(),
        error: z.string().optional(),
      })
    ),
    drift: z
      .array(
        z.object({
          tool: z.string(),
          violations: z.array(
            z.object({ path: z.string(), message: z.string() })
          ),
        })
      )
      .describe(
        "Where a tool's real result contradicted the catalog's declared shape."
      ),
    durationMs: z.int(),
  })
  .meta({ id: "RunReport" })

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
      })
    ),
  })
  .meta({ id: "RevalidateResponse" })
