/**
 * What the sandbox guarantees when validation has already been defeated.
 *
 * Most of these run code that would never pass `validateScript` — that is the
 * point. The static pass is a correctness gate; these are the properties that have
 * to hold anyway.
 *
 * Every tool call here goes to the real Arcade API through the real executor. The
 * `callTool` parameter is dependency injection, not a seam for fakes: `runScript`
 * passes the same function in production. `Math` is the fixture because its tools
 * need no authorization and return deterministic answers — so a failing assertion
 * means the sandbox is wrong, not that a stub drifted from reality.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { assemble } from "./assemble"
import { compileScript } from "./compile"
import { runInSandbox, type SandboxOptions } from "./sandbox"
import { realBridge, requireArcadeKey } from "./testing"

beforeAll(requireArcadeKey)

/** Hands the guest arbitrary JavaScript, bypassing compilation. */
const raw = (body: string) =>
  `var __config = { run: async function (input, ctx) {\n${body}\n} };`

const ADD = { "math.add": "Math.Add" }

const run = (compiled: string, options: Partial<SandboxOptions> = {}) =>
  runInSandbox({
    compiled,
    grant: {},
    input: {},
    callTool: realBridge,
    ...options,
  })

describe("the guest holds no capability it was not handed", () => {
  it("has no host globals at all", async () => {
    const outcome = await run(
      raw(`
  var found = [];
  var names = ["fetch","require","process","setTimeout","setInterval","console","WebAssembly",
               "std","os","print","XMLHttpRequest","importScripts","Deno","Bun","module","exports"];
  for (var i = 0; i < names.length; i++) {
    if (typeof globalThis[names[i]] !== "undefined") found.push(names[i]);
  }
  return { reachable: found };
`)
    )

    expect(outcome.result).toEqual({ kind: "ok", output: { reachable: [] } })
  })

  it("cannot import a module", async () => {
    const outcome = await run(raw(`  return await import("node:fs");`))

    expect(outcome.result.kind).not.toBe("ok")
  })

  it("exposes only the granted tools, so an ungranted one is not even a property", async () => {
    const outcome = await run(
      raw(
        `  return { hasMath: typeof ctx.math, hasGithub: typeof ctx.github };`
      ),
      { grant: ADD }
    )

    expect(outcome.result).toEqual({
      kind: "ok",
      output: { hasMath: "object", hasGithub: "undefined" },
    })
  })

  it("refuses a tool outside the grant called through the bridge directly", async () => {
    const outcome = await run(
      raw(`
  try {
    await __callTool("github.whoAmI", "{}");
    return { blocked: false };
  } catch (error) {
    return { blocked: true, message: String(error && error.message) };
  }
`),
      { grant: ADD }
    )

    expect(outcome.result).toMatchObject({
      kind: "ok",
      output: { blocked: true },
    })
    // Nothing was dispatched: the refusal happened before the executor was reached.
    expect(outcome.toolCalls).toEqual([])
  })
})

describe("the bridge", () => {
  it("carries a real call to Arcade and back", async () => {
    const outcome = await run(
      raw(`  return { sum: await ctx.math.add({ a: "2", b: "3" }) };`),
      {
        grant: ADD,
      }
    )

    expect(outcome.result).toEqual({ kind: "ok", output: { sum: "5" } })
    expect(outcome.toolCalls).toMatchObject([
      { path: "math.add", qualifiedName: "Math.Add", ok: true },
    ])
  })

  it("crosses nested arguments intact, as JSON rather than a live object", async () => {
    // If the array were flattened, stringified twice or passed by reference, the
    // sum upstream would be wrong — the assertion is on Arcade's own arithmetic.
    const outcome = await run(
      raw(
        `  return { total: await ctx.math.sumList({ numbers: ["1", "2", "3.5"] }) };`
      ),
      { grant: { "math.sumList": "Math.SumList" } }
    )

    expect(outcome.result).toEqual({ kind: "ok", output: { total: "6.5" } })
  })

  it("surfaces a real upstream failure to guest `catch`", async () => {
    const outcome = await run(
      raw(`
  try {
    await ctx.math.divide({ a: "1", b: "0" });
    return { threw: false };
  } catch (error) {
    return { threw: true, message: String(error && error.message) };
  }
`),
      { grant: { "math.divide": "Math.Divide" } }
    )

    expect(outcome.result).toMatchObject({
      kind: "ok",
      output: { threw: true },
    })
    const [call] = outcome.toolCalls
    expect(call).toMatchObject({ qualifiedName: "Math.Divide", ok: false })
    expect(call?.error).toContain("DivisionByZero")
  })
})

describe("limits", () => {
  it("stops an unbounded loop at the deadline", async () => {
    const outcome = await run(raw(`  while (true) {}`), {
      limits: { timeoutMs: 400 },
    })

    expect(outcome.result).toMatchObject({
      kind: "limit_exceeded",
      limit: "cpu",
    })
    expect(outcome.durationMs).toBeLessThan(3_000)
  })

  it("stops unbounded allocation", async () => {
    const outcome = await run(
      raw(`  var held = [];
  for (var i = 0; i < 1e9; i++) held.push(new Array(10000).fill("x"));`),
      { limits: { timeoutMs: 20_000, memoryBytes: 16 * 1024 * 1024 } }
    )

    expect(outcome.result).toMatchObject({
      kind: "limit_exceeded",
      limit: "memory",
    })
  })

  it("caps the number of tool calls", async () => {
    const outcome = await run(
      raw(`  for (var i = 0; i < 8; i++) await ctx.math.add({ a: "1", b: "1" });
  return { done: true };`),
      { grant: ADD, limits: { maxToolCalls: 3 } }
    )

    expect(outcome.result).toMatchObject({
      kind: "limit_exceeded",
      limit: "tool_calls",
    })
    expect(outcome.toolCalls).toHaveLength(3)
  })

  it("bounds a real host call that outlives the deadline", async () => {
    // The interrupt handler only runs between bytecode instructions and cannot
    // preempt a pending host call, so the bridge races the deadline itself. A
    // round trip to Arcade reliably outlasts 5ms.
    const outcome = await run(
      raw(`  return await ctx.math.add({ a: "2", b: "3" });`),
      {
        grant: ADD,
        limits: { timeoutMs: 5 },
      }
    )

    expect(outcome.result.kind).not.toBe("ok")
    expect(outcome.durationMs).toBeLessThan(5_000)
  })

  it("caps output size", async () => {
    const outcome = await run(raw(`  return { big: "x".repeat(100000) };`), {
      limits: { maxOutputBytes: 1024 },
    })

    expect(outcome.result).toMatchObject({
      kind: "limit_exceeded",
      limit: "output_bytes",
    })
  })
})

describe("results", () => {
  it("runs a compiled script and reports its logs and calls", async () => {
    const assembly = assemble({
      input: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      output: {
        type: "object",
        properties: { sum: { type: "string" } },
        required: ["sum"],
      },
      run: `async run(input, { math, log }) {
  const sum = await math.add({ a: input.a, b: input.b });
  log("added", input.a, input.b);
  return { sum };
}`,
    })
    if (!assembly.ok) throw new Error("fixture failed to assemble")

    const outcome = await run(compileScript(assembly.assembled.source), {
      grant: ADD,
      input: { a: "20", b: "22" },
    })

    expect(outcome.result).toEqual({ kind: "ok", output: { sum: "42" } })
    expect(outcome.logs).toEqual(["added 20 22"])
    expect(outcome.toolCalls).toMatchObject([{ path: "math.add", ok: true }])
  })

  it("surfaces a thrown guest error as a script error, not a crash", async () => {
    const outcome = await run(raw(`  throw new TypeError("nope");`))

    expect(outcome.result).toMatchObject({
      kind: "script_error",
      name: "TypeError",
      message: "nope",
    })
  })
})
