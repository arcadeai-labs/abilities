/**
 * The whole pipeline, end to end: validate → store → run → record.
 *
 * Nothing is substituted. Scripts are stored through the real gate, executed in the
 * real sandbox, and their tools dispatched to the real Arcade API as a real end
 * user. `Math` supplies deterministic arithmetic with no authorization; `Github`
 * supplies a tool that genuinely requires it, for the pre-flight.
 */

import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, migrateDb } from "./db";
import { revalidateAll, runScript, storeScript } from "./execute";
import { runs, type ScriptRow, scripts } from "./schema";
import { requireArcadeKey, TEST_USER, UNAUTHORIZED_USER } from "./testing";

const PREFIX = "vitest-";

beforeAll(async () => {
  requireArcadeKey();
  await migrateDb();
  await db.delete(scripts).where(like(scripts.name, `${PREFIX}%`));
});

afterAll(async () => {
  await db.delete(scripts).where(like(scripts.name, `${PREFIX}%`));
});

let counter = 0;
async function store(source: string): Promise<ScriptRow> {
  const result = await storeScript({ name: `${PREFIX}${++counter}`, source });
  if (!result.ok) {
    throw new Error(
      "conflict" in result
        ? result.conflict
        : `expected valid, got: ${result.validation.diagnostics.map((d) => `${d.code} ${d.message}`).join(" | ")}`,
    );
  }
  return result.script;
}

describe("storing", () => {
  it("refuses an invalid script and writes nothing", async () => {
    const before = await db.select().from(scripts);
    const result = await storeScript({
      name: `${PREFIX}invalid`,
      source: `
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ sum: z.number() }),
  async run(input, { math }) {
    return { sum: await math.add({ a: "1", b: "2" }) };
  },
});
`,
    });

    expect(result.ok).toBe(false);
    // `Math.Add` returns a string; the contract promises a number.
    if (!result.ok && "validation" in result) {
      expect(result.validation.diagnostics.map((d) => d.code)).toContain("TS2322");
    }
    expect(await db.select().from(scripts)).toHaveLength(before.length);
  });

  it("records the grant derived from the source", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ sum: z.string() }),
  async run(input, { math }) {
    return { sum: await math.add({ a: "1", b: "2" }) };
  },
});
`);

    expect(script.toolGrant).toEqual({ "math.add": "Math.Add" });
    expect(script.namespaces).toEqual(["math"]);
    expect(script.version).toBe(1);
  });

  it("reports nothing stale immediately after storing", async () => {
    await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ sum: z.string() }),
  async run(input, { math }) {
    return { sum: await math.add({ a: "4", b: "4" }) };
  },
});
`);

    const report = await revalidateAll();
    expect(report.stale.filter((s) => s.name.startsWith(PREFIX))).toEqual([]);
  });
});

describe("running", () => {
  it("executes against the real API and persists the run", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({ a: z.string(), b: z.string() }),
  output: z.object({ sum: z.string(), doubled: z.string() }),
  async run(input, { math, log }) {
    const sum = await math.add({ a: input.a, b: input.b });
    log("sum is", sum);
    const doubled = await math.multiply({ a: sum, b: "2" });
    return { sum, doubled };
  },
});
`);

    const report = await runScript({ script, input: { a: "2", b: "3" }, userId: TEST_USER });

    expect(report.outcome).toEqual({ kind: "ok", output: { sum: "5", doubled: "10" } });
    expect(report.logs).toEqual(["sum is 5"]);
    expect(report.toolCalls.map((c) => c.qualifiedName)).toEqual(["Math.Add", "Math.Multiply"]);
    expect(report.drift).toEqual([]);

    const [persisted] = await db.select().from(runs).where(eq(runs.id, report.runId));
    expect(persisted).toMatchObject({ scriptId: script.id, userId: TEST_USER });
    expect(persisted?.finishedAt).not.toBeNull();
    expect(persisted?.outcome).toMatchObject({ kind: "ok" });
  });

  it("rejects input the declared contract does not allow, before anything runs", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({ a: z.string() }),
  output: z.object({ sum: z.string() }),
  async run(input, { math }) {
    return { sum: await math.add({ a: input.a, b: "1" }) };
  },
});
`);

    const report = await runScript({ script, input: { a: 7 }, userId: TEST_USER });

    expect(report.outcome).toMatchObject({
      kind: "input_invalid",
      violations: [{ path: "a", message: "expected string, got number" }],
    });
    expect(report.toolCalls).toEqual([]);
  });

  it("fails the run when the result breaks the declared output", async () => {
    // Type-checks — `Number(...)` is a number — but 6.5 is not an integer, so the
    // contract only catches it once a real value comes back.
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ total: z.number().int() }),
  async run(input, { math }) {
    const total = await math.sumList({ numbers: ["1", "2", "3.5"] });
    return { total: Number(total) };
  },
});
`);

    const report = await runScript({ script, input: {}, userId: TEST_USER });

    expect(report.outcome).toMatchObject({
      kind: "contract_violation",
      violations: [{ path: "total", message: "expected an integer" }],
    });
    // The tool did run; it is the script's promise about its own output that broke.
    expect(report.toolCalls).toMatchObject([{ qualifiedName: "Math.SumList", ok: true }]);
  });

  it("reports an upstream tool failure as a tool error, not a script error", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ quotient: z.string() }),
  async run(input, { math }) {
    return { quotient: await math.divide({ a: "1", b: "0" }) };
  },
});
`);

    const report = await runScript({ script, input: {}, userId: TEST_USER });

    expect(report.outcome).toMatchObject({ kind: "tool_error", tool: "Math.Divide" });
    expect((report.outcome as { message: string }).message).toContain("DivisionByZero");
  });

  it("stops before the sandbox when the user has not authorized a tool", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ login: z.string() }),
  async run(input, { github }) {
    const me = await github.whoAmI({});
    return { login: me.profile?.login ?? "unknown" };
  },
});
`);

    const report = await runScript({ script, input: {}, userId: UNAUTHORIZED_USER });

    expect(report.outcome).toMatchObject({ kind: "authorization_required" });
    const { tools } = report.outcome as { tools: { qualifiedName: string; authUrl?: string }[] };
    expect(tools[0]?.qualifiedName).toBe("Github.WhoAmI");
    expect(tools[0]?.authUrl).toMatch(/^https:\/\//);
    // Nothing executed, so nothing had an effect.
    expect(report.toolCalls).toEqual([]);
  });

  it("enforces the stored grant even when it is narrower than the source", async () => {
    const script = await store(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ sum: z.string() }),
  async run(input, { math }) {
    return { sum: await math.add({ a: "1", b: "1" }) };
  },
});
`);

    // Simulates the grant being tightened after validation — the sandbox builds its
    // tool surface from this column, not from the source.
    await db.update(scripts).set({ toolGrant: {} }).where(eq(scripts.id, script.id));
    const [narrowed] = await db.select().from(scripts).where(eq(scripts.id, script.id));

    const report = await runScript({ script: narrowed!, input: {}, userId: TEST_USER });

    expect(report.outcome.kind).toBe("script_error");
    expect(report.toolCalls).toEqual([]);
  });
});
