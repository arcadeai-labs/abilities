/**
 * The whole pipeline, end to end: validate → store → run → record.
 *
 * Nothing is substituted. Scripts are stored through the real gate, executed in the
 * real sandbox, and their tools dispatched to the real Arcade API as a real end
 * user. `Math` supplies deterministic arithmetic with no authorization; `Github`
 * supplies a tool that genuinely requires it, for the pre-flight.
 */

import { eq, like } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "./app"
import type { ScriptParams } from "./assemble"
import { db, migrateDb } from "./db"
import { revalidateAll, runScript, upsertScript } from "./execute"
import { runs, type ScriptRow, scripts } from "./schema"
import { requireArcadeKey, TEST_USER, UNAUTHORIZED_USER } from "./testing"

const PREFIX = "vitest-"

beforeAll(async () => {
  requireArcadeKey()
  await migrateDb()
  await db.delete(scripts).where(like(scripts.name, `${PREFIX}%`))
})

afterAll(async () => {
  await db.delete(scripts).where(like(scripts.name, `${PREFIX}%`))
})

let counter = 0
async function store(params: ScriptParams): Promise<ScriptRow> {
  const result = await upsertScript({ name: `${PREFIX}${++counter}`, params })
  if (!result.ok) {
    const detail = result.validation.diagnostics
      .map((d: { code: string; message: string }) => `${d.code} ${d.message}`)
      .join(" | ")
    throw new Error(`expected valid, got: ${detail}`)
  }
  return result.script
}

describe("storing", () => {
  it("refuses an invalid script and writes nothing", async () => {
    const before = await db.select().from(scripts)
    const result = await upsertScript({
      name: `${PREFIX}invalid`,
      params: {
        input: { type: "object", properties: {} },
        output: {
          type: "object",
          properties: { sum: { type: "number" } },
          required: ["sum"],
        },
        toolkits: ["math"],
        run: `async run(input, { math }) {
  return { sum: await math.add({ a: "1", b: "2" }) };
}`,
      },
    })

    expect(result.ok).toBe(false)
    // `Math.Add` returns a string; the contract promises a number.
    if (!result.ok) {
      expect(
        result.validation.diagnostics.map((d: { code: string }) => d.code)
      ).toContain("TS2322")
    }
    expect(await db.select().from(scripts)).toHaveLength(before.length)
  })

  it("records the grant derived from the source", async () => {
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: "1", b: "2" }) };
}`,
    })

    expect(script.toolGrant).toEqual({ "math.add": "Math.Add" })
    expect(script.version).toBe(1)
  })

  it("reports nothing stale immediately after storing", async () => {
    await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: "4", b: "4" }) };
}`,
    })

    const report = await revalidateAll()
    expect(report.stale.filter((s) => s.name.startsWith(PREFIX))).toEqual([])
  })
})

describe("addressing", () => {
  it("resolves a script by name or by id", async () => {
    // The list response carries `id` and run records point at it, so the obvious
    // next request has to work — names exclude `_`, so the two cannot collide.
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: "1", b: "1" }) };
}`,
    })

    const byName = await app.request(`/api/scripts/${script.name}`)
    const byId = await app.request(`/api/scripts/${script.id}`)

    expect([byName.status, byId.status]).toEqual([200, 200])
    expect(await byName.json()).toEqual(await byId.json())
  })

  it("refuses a name that could be mistaken for an id", async () => {
    const response = await app.request("/api/scripts/scr_pretending", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { type: "object", properties: {} },
        output: { type: "object", properties: {} },
        run: "async run(input, { log }) {\n  return {};\n}",
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "invalid_name" })
  })
})

describe("the run request", () => {
  it("accepts a body with no `input` for a script that takes none", async () => {
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: "1", b: "1" }) };
}`,
    })

    const response = await app.request(`/api/scripts/${script.name}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TEST_USER }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: { kind: "ok", output: { sum: "2" } },
    })
  })

  it("says what is missing when the body is empty, rather than blaming the JSON", async () => {
    const response = await app.request("/api/scripts/anything/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
    })

    expect(response.status).toBe(400)
    const body: { error?: { path?: string[] }[] } = JSON.parse(
      await response.text()
    )
    // Not "Malformed JSON in request body" — an absent body has no syntax to blame.
    expect(body.error?.[0]?.path).toEqual(["userId"])
  })
})

describe("running", () => {
  it("executes against the real API and persists the run", async () => {
    const script = await store({
      input: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      output: {
        type: "object",
        properties: { sum: { type: "string" }, doubled: { type: "string" } },
        required: ["sum", "doubled"],
      },
      toolkits: ["math"],
      run: `async run(input, { math, log }) {
  const sum = await math.add({ a: input.a, b: input.b });
  log("sum is", sum);
  const doubled = await math.multiply({ a: sum, b: "2" });
  return { sum, doubled };
}`,
    })

    const report = await runScript({
      script,
      input: { a: "2", b: "3" },
      userId: TEST_USER,
    })

    expect(report.outcome).toEqual({
      kind: "ok",
      output: { sum: "5", doubled: "10" },
    })
    expect(report.logs).toEqual(["sum is 5"])
    expect(report.toolCalls.map((c) => c.qualifiedName)).toEqual([
      "Math.Add",
      "Math.Multiply",
    ])
    expect(report.drift).toEqual([])

    const [persisted] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, report.runId))
    expect(persisted).toMatchObject({ scriptId: script.id, userId: TEST_USER })
    expect(persisted?.finishedAt).not.toBeNull()
    expect(persisted?.outcome).toMatchObject({ kind: "ok" })
  })

  it("rejects input the declared contract does not allow, before anything runs", async () => {
    const script = await store({
      input: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: input.a, b: "1" }) };
}`,
    })

    const report = await runScript({
      script,
      input: { a: 7 },
      userId: TEST_USER,
    })

    expect(report.outcome).toMatchObject({
      kind: "input_invalid",
      violations: [{ path: "a", message: "expected string, got number" }],
    })
    expect(report.toolCalls).toEqual([])
  })

  it("fails the run when the result breaks the declared output", async () => {
    // Type-checks — `Number(...)` is a number — but 6.5 is not an integer, so the
    // contract only catches it once a real value comes back.
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { total: { type: "integer" } },
        required: ["total"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  const total = await math.sumList({ numbers: ["1", "2", "3.5"] });
  return { total: Number(total) };
}`,
    })

    const report = await runScript({ script, input: {}, userId: TEST_USER })

    expect(report.outcome).toMatchObject({
      kind: "contract_violation",
      violations: [{ path: "total", message: "expected an integer" }],
    })
    // The tool did run; it is the script's promise about its own output that broke.
    expect(report.toolCalls).toMatchObject([
      { qualifiedName: "Math.SumList", ok: true },
    ])
  })

  it("narrows a result with `z.parse()` inside the sandbox", async () => {
    // `parse` runs in the guest, not host-side: it is the script asserting a shape
    // over a value it is about to use, which is its own business.
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  const sum = z.string().parse(await math.add({ a: "2", b: "3" }));
  return { sum };
}`,
    })

    const report = await runScript({ script, input: {}, userId: TEST_USER })

    expect(report.outcome).toEqual({ kind: "ok", output: { sum: "5" } })
  })

  it("fails the run when a `z.parse()` assertion is wrong", async () => {
    // Type-checks — `parse` returns a number — but `Math.Add` really returns "5",
    // so the assertion is false and the guest throws.
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "number" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  const sum = z.number().parse(await math.add({ a: "2", b: "3" }));
  return { sum };
}`,
    })

    const report = await runScript({ script, input: {}, userId: TEST_USER })

    expect(report.outcome).toMatchObject({
      kind: "script_error",
      name: "TypeError",
      message: expect.stringContaining("expected number"),
    })
    // The tool did run — the assertion failed after it returned.
    expect(report.toolCalls).toMatchObject([
      { qualifiedName: "Math.Add", ok: true },
    ])
  })

  it("reports an upstream tool failure as a tool error, not a script error", async () => {
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { quotient: { type: "string" } },
        required: ["quotient"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { quotient: await math.divide({ a: "1", b: "0" }) };
}`,
    })

    const report = await runScript({ script, input: {}, userId: TEST_USER })

    expect(report.outcome).toMatchObject({
      kind: "tool_error",
      tool: "Math.Divide",
      message: expect.stringContaining("DivisionByZero"),
    })
  })

  it("stops before the sandbox when the user has not authorized a tool", async () => {
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { login: { type: "string" } },
        required: ["login"],
      },
      toolkits: ["github"],
      run: `async run(input, { github }) {
  const me = await github.whoAmI({});
  return { login: me.profile?.login ?? "unknown" };
}`,
    })

    const report = await runScript({
      script,
      input: {},
      userId: UNAUTHORIZED_USER,
    })

    expect(report.outcome).toMatchObject({ kind: "authorization_required" })
    if (report.outcome.kind !== "authorization_required") {
      throw new Error("unreachable: the expectation above just passed")
    }
    const { tools } = report.outcome
    expect(tools[0]?.qualifiedName).toBe("Github.WhoAmI")
    expect(tools[0]?.authUrl).toMatch(/^https:\/\//)
    // Nothing executed, so nothing had an effect.
    expect(report.toolCalls).toEqual([])
  })

  it("enforces the stored grant even when it is narrower than the source", async () => {
    const script = await store({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      toolkits: ["math"],
      run: `async run(input, { math }) {
  return { sum: await math.add({ a: "1", b: "1" }) };
}`,
    })

    // Simulates the grant being tightened after validation — the sandbox builds its
    // tool surface from this column, not from the source.
    await db
      .update(scripts)
      .set({ toolGrant: {} })
      .where(eq(scripts.id, script.id))
    const [narrowed] = await db
      .select()
      .from(scripts)
      .where(eq(scripts.id, script.id))
    if (!narrowed) throw new Error("the script written above has vanished")

    const report = await runScript({
      script: narrowed,
      input: {},
      userId: TEST_USER,
    })

    expect(report.outcome.kind).toBe("script_error")
    expect(report.toolCalls).toEqual([])
  })
})
