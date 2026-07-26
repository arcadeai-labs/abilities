/**
 * Storing and running scripts — the two operations that have consequences.
 *
 * Storing is gated on validation, which is what makes `scripts` hold an invariant
 * rather than a pile of text. Running assumes validation was defeated: the grant is
 * re-enforced, arguments are re-checked against the catalog, and the result is
 * re-checked against the declared contract, because a type checker can be lied to
 * and a stored row can drift.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { checkAuthorization, executeTool, ToolExecutionError } from "./arcade";
import { loadCatalog } from "./catalog";
import { compileScript } from "./compile";
import { db } from "./db";
import { type Spec, validateSpec, type Violation } from "./schema-dsl";
import { runs, type ScriptRow, scripts } from "./schema";
import type { ScriptParams } from "./assemble";
import { type Contract, validateScript, type ValidationResult } from "./validate";

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

export type StoreResult =
  | { ok: true; script: ScriptRow; created: boolean }
  | { ok: false; validation: ValidationResult };

/**
 * Validates, then stores. Never the other way round — which is what lets the
 * `scripts` table hold an invariant rather than a pile of text.
 *
 * Upsert by name: the name is the key an author already has, so writing the same
 * script twice updates it instead of failing, and the caller needs no read first.
 */
export async function upsertScript(input: {
  name: string;
  description?: string | null;
  params: ScriptParams;
}): Promise<StoreResult> {
  const validation = await validateScript(input.params);
  if (!validation.ok || !validation.contract || !validation.source) {
    return { ok: false, validation };
  }

  const now = new Date();
  const row = {
    name: input.name,
    description: input.description ?? null,
    run: input.params.run,
    inputSchema: input.params.input,
    outputSchema: input.params.output,
    expectSchemas: (input.params.expect ?? {}) as Record<string, unknown>,
    compiled: compileScript(validation.source),
    toolGrant: validation.grant,
    namespaces: validation.namespaces,
    contract: validation.contract,
    snapshotId: validation.snapshotId,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: scripts.id, version: scripts.version })
    .from(scripts)
    .where(eq(scripts.name, input.name));

  if (existing) {
    const [updated] = await db
      .update(scripts)
      .set({ ...row, version: existing.version + 1 })
      .where(eq(scripts.id, existing.id))
      .returning();
    return { ok: true, script: updated!, created: false };
  }

  const [created] = await db
    .insert(scripts)
    .values({ ...row, id: id("scr"), version: 1, createdAt: now })
    .returning();
  return { ok: true, script: created!, created: true };
}

export type RunOutcome =
  | { kind: "ok"; output: unknown }
  | { kind: "input_invalid"; violations: Violation[] }
  | { kind: "authorization_required"; tools: { qualifiedName: string; authUrl?: string }[] }
  | { kind: "script_error"; name: string; message: string }
  | { kind: "tool_error"; tool: string; message: string }
  | { kind: "contract_violation"; violations: Violation[] }
  | { kind: "limit_exceeded"; limit: string; message: string };

export type RunReport = {
  runId: string;
  outcome: RunOutcome;
  logs: string[];
  toolCalls: { path: string; qualifiedName: string; ok: boolean; durationMs: number; error?: string }[];
  /** Places the catalog's declared shape did not match what a tool actually returned. */
  drift: { tool: string; violations: Violation[] }[];
  durationMs: number;
};

export async function runScript(options: {
  script: ScriptRow;
  input: unknown;
  userId: string;
}): Promise<RunReport> {
  const catalog = await loadCatalog();
  const contract = options.script.contract as Contract;
  const grant = options.script.toolGrant;

  const runId = id("run");
  const startedAt = new Date();

  const finish = async (report: Omit<RunReport, "runId">): Promise<RunReport> => {
    const full: RunReport = { ...report, runId };
    await db
      .update(runs)
      .set({
        outcome: full.outcome,
        logs: full.logs,
        toolCalls: full.toolCalls,
        durationMs: full.durationMs,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId));
    return full;
  };

  // Written before anything executes: a run that dies mid-way must still leave a
  // record of the tool calls it already made.
  await db.insert(runs).values({
    id: runId,
    scriptId: options.script.id,
    scriptVersion: options.script.version,
    userId: options.userId,
    input: options.input,
    startedAt,
  });

  const inputViolations = validateSpec(contract.input, options.input);
  if (inputViolations.length > 0) {
    return finish({
      outcome: { kind: "input_invalid", violations: inputViolations },
      logs: [],
      toolCalls: [],
      drift: [],
      durationMs: 0,
    });
  }

  const needsAuth = Object.values(grant).filter(
    (qualifiedName) => catalog.runtime.get(qualifiedName)?.requiresAuth,
  );
  if (needsAuth.length > 0) {
    const authorization = await checkAuthorization(needsAuth, options.userId);
    if (!authorization.ready) {
      return finish({
        outcome: {
          kind: "authorization_required",
          tools: authorization.tools
            .filter((tool) => tool.status === "pending")
            .map(({ qualifiedName, authUrl }) => ({ qualifiedName, authUrl })),
        },
        logs: [],
        toolCalls: [],
        drift: [],
        durationMs: 0,
      });
    }
  }

  const drift: RunReport["drift"] = [];
  let toolError: { tool: string; message: string } | undefined;

  const { runInSandbox } = await import("./sandbox");
  const run = await runInSandbox({
    compiled: options.script.compiled,
    grant,
    input: options.input,
    callTool: async (qualifiedName, path, args) => {
      const runtime = catalog.runtime.get(qualifiedName);
      const expected = contract.expect[path] as Spec | undefined;

      // The type checker already covered this; doing it again costs nothing and
      // holds even if the stored compiled source and grant ever disagree.
      const argumentViolations = runtime
        ? validateSpec(runtime.input, args ?? {})
        : [{ path: "(root)", message: `unknown tool ${qualifiedName}` }];
      if (argumentViolations.length > 0) {
        throw new ToolExecutionError(
          `Arguments to \`${path}\` are invalid: ${describe(argumentViolations)}`,
        );
      }

      const result = await executeTool(qualifiedName, args as Record<string, unknown>, options.userId);

      // An `expect` is the author's assertion, so breaking it fails the run. The
      // catalog's own shape is only a description, so breaking it is drift.
      if (expected) {
        const violations = validateSpec(expected, result);
        if (violations.length > 0) {
          throw new ToolExecutionError(
            `\`${path}\` did not match its \`expect\` shape: ${describe(violations)}`,
          );
        }
      } else if (runtime?.output) {
        const violations = validateSpec(runtime.output, result);
        if (violations.length > 0) drift.push({ tool: qualifiedName, violations });
      }

      return result;
    },
  });

  // A rejected tool call surfaces to the guest, which may swallow it; the host's
  // own record is what decides whether this was the script's fault or a tool's.
  const failedCall = run.toolCalls.find((call) => !call.ok);
  if (failedCall) toolError = { tool: failedCall.qualifiedName, message: failedCall.error ?? "failed" };

  const shared = {
    logs: run.logs,
    toolCalls: run.toolCalls,
    drift,
    durationMs: run.durationMs,
  };

  if (run.result.kind === "limit_exceeded") {
    return finish({
      outcome: { kind: "limit_exceeded", limit: run.result.limit, message: run.result.message },
      ...shared,
    });
  }

  if (run.result.kind === "script_error") {
    return finish({
      outcome: toolError
        ? { kind: "tool_error", ...toolError }
        : { kind: "script_error", name: run.result.name, message: run.result.message },
      ...shared,
    });
  }

  const outputViolations = validateSpec(contract.output, run.result.output);
  if (outputViolations.length > 0) {
    return finish({ outcome: { kind: "contract_violation", violations: outputViolations }, ...shared });
  }

  return finish({ outcome: { kind: "ok", output: run.result.output }, ...shared });
}

const describe = (violations: Violation[]) =>
  violations
    .slice(0, 3)
    .map((violation) => `${violation.path} ${violation.message}`)
    .join("; ");

/** Re-checks every stored script against the current catalog. */
export async function revalidateAll(): Promise<{
  snapshotId: string;
  checked: number;
  stale: { id: string; name: string; diagnostics: number; firstError: string | null }[];
}> {
  const catalog = await loadCatalog();
  const rows = await db.select().from(scripts);
  const stale: { id: string; name: string; diagnostics: number; firstError: string | null }[] = [];

  for (const row of rows) {
    const validation = await validateScript({
      input: row.inputSchema as never,
      output: row.outputSchema as never,
      expect: row.expectSchemas as never,
      run: row.run,
    });
    if (validation.ok) {
      if (row.snapshotId !== catalog.snapshotId) {
        await db
          .update(scripts)
          .set({ snapshotId: catalog.snapshotId, toolGrant: validation.grant })
          .where(eq(scripts.id, row.id));
      }
      continue;
    }
    stale.push({
      id: row.id,
      name: row.name,
      diagnostics: validation.diagnostics.length,
      firstError: validation.diagnostics.find((d) => d.severity === "error")?.message ?? null,
    });
  }

  return { snapshotId: catalog.snapshotId, checked: rows.length, stale };
}
