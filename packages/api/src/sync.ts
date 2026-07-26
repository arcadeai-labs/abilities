import Arcade from "@arcadeai/arcadejs";
import type { ToolDefinition } from "@arcadeai/arcadejs/resources/tools/tools";
import { lt, sql } from "drizzle-orm";
import { db, migrateDb } from "./db";
import { tools, type NewToolRow } from "./schema";

const PAGE_SIZE = 100;
/** 14 columns per row; Postgres caps a statement at 65535 bind params. */
const INSERT_BATCH = 500;
/** Concurrent page fetches. Sequential paging costs ~2s/page — 80+ pages is minutes. */
const FETCH_CONCURRENCY = 8;

export type SyncResult = {
  fetched: number;
  unique: number;
  duplicates: number;
  swept: number;
  totalCount: number;
  pages: number;
  rows: number;
  durationMs: number;
};

const toRow = (t: ToolDefinition, syncedAt: Date): NewToolRow => ({
  fullyQualifiedName: t.fully_qualified_name,
  name: t.name,
  qualifiedName: t.qualified_name,
  description: t.description ?? null,
  toolkitName: t.toolkit.name,
  toolkitDescription: t.toolkit.description ?? null,
  toolkitVersion: t.toolkit.version ?? null,
  input: t.input ?? null,
  output: t.output ?? null,
  requirements: t.requirements ?? null,
  metadata: t.metadata ?? null,
  formattedSchema: t.formatted_schema ?? null,
  raw: t,
  syncedAt,
});

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

const upsert = (tx: Executor, rows: NewToolRow[]) =>
  tx
    .insert(tools)
    .values(rows)
    .onConflictDoUpdate({
      target: tools.fullyQualifiedName,
      set: {
        name: sql`excluded.name`,
        qualifiedName: sql`excluded.qualified_name`,
        description: sql`excluded.description`,
        toolkitName: sql`excluded.toolkit_name`,
        toolkitDescription: sql`excluded.toolkit_description`,
        toolkitVersion: sql`excluded.toolkit_version`,
        input: sql`excluded.input`,
        output: sql`excluded.output`,
        requirements: sql`excluded.requirements`,
        metadata: sql`excluded.metadata`,
        formattedSchema: sql`excluded.formatted_schema`,
        raw: sql`excluded.raw`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

/**
 * Mirrors every tool from the Arcade API into the local `tools` table.
 *
 * Idempotent by construction: migrations are tracked, rows upsert on their
 * primary key, and anything not re-stamped by this run is swept, so repeated
 * calls converge on the same state rather than accumulating.
 */
export async function syncTools(opts: { onPage?: (info: { page: number; offset: number; count: number; fetched: number; totalCount: number }) => void } = {}): Promise<SyncResult> {
  const startedAt = new Date();
  await migrateDb();

  const client = new Arcade();
  const firstPage = await client.tools.list({ limit: PAGE_SIZE, offset: 0 });
  const totalCount = firstPage.total_count;

  const rows = new Map<string, NewToolRow>();
  let fetched = 0;
  let pages = 0;

  const collect = (items: ToolDefinition[], offset: number) => {
    pages++;
    for (const tool of items) {
      fetched++;
      // Offset pagination over a shifting dataset can hand back the same tool
      // twice; a keyed map means one INSERT can't conflict with itself.
      rows.set(tool.fully_qualified_name, toRow(tool, startedAt));
    }
    opts.onPage?.({ page: pages, offset, count: items.length, fetched, totalCount });
  };

  collect(firstPage.items, firstPage.offset);

  // total_count is known from page 1, so the rest are fetched by explicit offset
  // instead of chaining next-page links. Offsets are independent, so a bounded
  // pool turns minutes of sequential round-trips into seconds.
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < totalCount; o += PAGE_SIZE) offsets.push(o);

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, offsets.length) }, async () => {
      while (cursor < offsets.length) {
        const offset = offsets[cursor++]!;
        const page = await client.tools.list({ limit: PAGE_SIZE, offset });
        collect(page.items, offset);
      }
    }),
  );

  const deduped = [...rows.values()];

  // One transaction for the whole write, so a failure mid-sweep can't leave the
  // table half-updated — either the mirror advances completely or not at all.
  const swept = await db.transaction(async (tx) => {
    for (let i = 0; i < deduped.length; i += INSERT_BATCH) {
      await upsert(tx, deduped.slice(i, i + INSERT_BATCH));
    }
    // Mark-and-sweep: anything not re-stamped by this run is gone upstream.
    const stale = await tx
      .delete(tools)
      .where(lt(tools.syncedAt, startedAt))
      .returning({ fullyQualifiedName: tools.fullyQualifiedName });
    return stale.length;
  });

  const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(tools);

  return {
    fetched,
    unique: deduped.length,
    duplicates: fetched - deduped.length,
    swept,
    totalCount,
    pages,
    rows: countRows[0]?.count ?? 0,
    durationMs: Date.now() - startedAt.getTime(),
  };
}
