/**
 * The mirrored catalog, in the shape codegen and validation want, cached per sync.
 *
 * Identifiers are derived once over the *whole* catalog even though most callers
 * ask for a couple of toolkits: collision resolution depends on everything present,
 * so a per-request name map would hand the same tool different names depending on
 * the filter. That would leak into stored grants, which have to stay stable.
 */

import { createHash } from "node:crypto";
import { asc, count, max } from "drizzle-orm";
import type { CodegenTool } from "./codegen";
import { db } from "./db";
import { buildNameMap, type NameMap } from "./naming";
import { type Spec, specFromToolInput, specFromValueSchema } from "./schema-dsl";
import { tools } from "./schema";
import { hasTypedOutput } from "./value-schema";

/** What the runtime needs to know about one tool, keyed by qualified name. */
export type ToolRuntime = {
  /** Arguments are checked against this before the call leaves the host. */
  input: Spec;
  /**
   * The catalog's declared result shape, or null when it says nothing.
   *
   * Descriptive, not contractual: a mismatch means the catalog is out of date, not
   * that the run should fail — a vendor adding a field must not break scripts.
   */
  output: Spec | null;
  requiresAuth: boolean;
};

export type Catalog = {
  /** Stable per sync; stored alongside a script so staleness is detectable. */
  snapshotId: string;
  syncedAt: Date | null;
  rows: CodegenTool[];
  nameMap: NameMap;
  /** Namespace (`github`) → its tools, for filtered codegen. */
  byNamespace: Map<string, CodegenTool[]>;
  runtime: Map<string, ToolRuntime>;
};

type CachedCatalog = Catalog & { fingerprint: string };

let cached: CachedCatalog | undefined;

/** Cheap enough to run per request; a full rebuild only happens after a sync. */
async function fingerprint(): Promise<{ value: string; rows: number; syncedAt: Date | null }> {
  const [row] = await db
    .select({ rows: count().mapWith(Number), syncedAt: max(tools.syncedAt) })
    .from(tools);
  const rows = row?.rows ?? 0;
  const syncedAt = row?.syncedAt ? new Date(row.syncedAt) : null;
  return { value: `${rows}:${syncedAt?.toISOString() ?? "empty"}`, rows, syncedAt };
}

export async function loadCatalog(): Promise<Catalog> {
  const current = await fingerprint();
  if (cached?.fingerprint === current.value) return cached;

  const rows = await db
    .select({
      name: tools.name,
      qualifiedName: tools.qualifiedName,
      fullyQualifiedName: tools.fullyQualifiedName,
      toolkitName: tools.toolkitName,
      description: tools.description,
      input: tools.input,
      output: tools.output,
      requirements: tools.requirements,
    })
    .from(tools)
    .orderBy(asc(tools.toolkitName), asc(tools.name));

  const nameMap = buildNameMap(rows);
  const runtime = new Map<string, ToolRuntime>(
    rows.map((row) => [
      row.qualifiedName,
      {
        input: specFromToolInput(row.input),
        output: hasTypedOutput(row.output) ? specFromValueSchema(row.output?.value_schema) : null,
        requiresAuth: Boolean(row.requirements?.authorization),
      },
    ]),
  );
  const byNamespace = new Map<string, CodegenTool[]>();
  const byQualifiedName = new Map(rows.map((row) => [row.qualifiedName, row] as const));

  for (const [namespace, entry] of nameMap.namespaces) {
    const namespaceTools: CodegenTool[] = [];
    for (const binding of entry.methods.values()) {
      const tool = byQualifiedName.get(binding.qualifiedName);
      if (tool) namespaceTools.push(tool);
    }
    byNamespace.set(namespace, namespaceTools);
  }

  const snapshotId = `snap_${createHash("sha256").update(current.value).digest("hex").slice(0, 16)}`;

  cached = {
    fingerprint: current.value,
    snapshotId,
    syncedAt: current.syncedAt,
    rows,
    nameMap,
    byNamespace,
    runtime,
  };
  return cached;
}

/** Per-toolkit output-schema coverage, straight off the mirror. */
export type CoverageRow = {
  toolkit: string;
  namespace: string;
  tools: number;
  typed: number;
  /** Toolkits ending in `Api` are generated from OpenAPI specs and declare nothing. */
  generated: boolean;
};

export async function coverage(): Promise<{
  totals: { toolkits: number; tools: number; typed: number };
  curated: { toolkits: number; tools: number; typed: number };
  generated: { toolkits: number; tools: number; typed: number };
  toolkits: CoverageRow[];
}> {
  const { rows, nameMap } = await loadCatalog();

  const byToolkit = new Map<string, CoverageRow>();
  for (const row of rows) {
    const namespace =
      [...nameMap.namespaces].find(([, entry]) => entry.toolkitName === row.toolkitName)?.[0] ?? "";
    const entry = byToolkit.get(row.toolkitName) ?? {
      toolkit: row.toolkitName,
      namespace,
      tools: 0,
      typed: 0,
      generated: /Api$/.test(row.toolkitName),
    };
    entry.tools++;
    if (hasTypedOutput(row.output)) entry.typed++;
    byToolkit.set(row.toolkitName, entry);
  }

  const list = [...byToolkit.values()].sort(
    (a, b) => b.typed / b.tools - a.typed / a.tools || b.tools - a.tools || a.toolkit.localeCompare(b.toolkit),
  );

  const sum = (subset: CoverageRow[]) => ({
    toolkits: subset.length,
    tools: subset.reduce((total, row) => total + row.tools, 0),
    typed: subset.reduce((total, row) => total + row.typed, 0),
  });

  return {
    totals: sum(list),
    curated: sum(list.filter((row) => !row.generated)),
    generated: sum(list.filter((row) => row.generated)),
    toolkits: list,
  };
}
