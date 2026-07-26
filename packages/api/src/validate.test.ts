/**
 * What validation must accept and must reject.
 *
 * The rejection cases are the security-relevant half: each one is a way a script
 * could otherwise reach a tool the stored grant doesn't name, or opt out of the
 * checks that make storing an unexecuted script meaningful. They exist so those
 * holes stay closed.
 *
 * Requires a synced catalog (`pnpm sync`); the toolkits used here are Github and
 * Slack, chosen because one declares output shapes and the other doesn't.
 */

import { describe, expect, it } from "vitest"
import type { ScriptParams } from "./assemble"
import type { JsonSchema } from "./json-schema"
import { validateScript } from "./validate"

const OK_OUTPUT: JsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
}

/** A script whose `run` body is `body`, returning `{ ok: true }`. */
const script = (
  body: string,
  over: Partial<ScriptParams> = {}
): ScriptParams => ({
  input: { type: "object", properties: {} },
  output: OK_OUTPUT,
  toolkits: ["github", "slack"],
  run: `async run(input, { github, slack, log }) {\n${body}\n  return { ok: true };\n}`,
  ...over,
})

const codes = (diagnostics: { code: string }[]) =>
  diagnostics.map((d) => d.code)

describe("accepts", () => {
  it("a script that conforms to its contract", async () => {
    const result = await validateScript({
      input: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue: { type: "integer" },
        },
        required: ["owner", "repo", "issue"],
      },
      output: {
        type: "object",
        properties: {
          escalated: { type: "boolean" },
          title: { type: "string" },
        },
        required: ["escalated", "title"],
      },
      toolkits: ["github", "slack"],
      run: `async run(input, { github, slack, log }) {
  const issue = await github.getIssue({
    owner: input.owner, repo: input.repo, issue_number: input.issue,
  });
  const title = issue.title ?? "(untitled)";
  log(\`issue is \${issue.state}\`);
  if (issue.state === "open") {
    await slack.sendMessage({ channel_name: "#oncall", message: title });
  }
  return { escalated: issue.state === "open", title };
}`,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("derives the grant from the destructured context, not from the type", async () => {
    const result = await validateScript(script(`  await github.whoAmI({});`))

    expect(result.ok).toBe(true)
    expect(result.grant).toEqual({ "github.whoAmI": "Github.WhoAmI" })
  })

  it("reports which granted tools leave their output unspecified", async () => {
    const result = await validateScript(
      script(`  await github.whoAmI({});\n  await slack.listUsers({});`)
    )

    expect(result.ok).toBe(true)
    expect(result.outputCoverage).toEqual([
      { path: "github.whoAmI", qualifiedName: "Github.WhoAmI", typed: true },
      {
        path: "slack.listUsers",
        qualifiedName: "Slack.ListUsers",
        typed: false,
      },
    ])
  })

  it("lets the author narrow an undeclared output in the code", async () => {
    // Slack declares no output shapes, so `sent` arrives as `unknown`. Asserting a
    // shape over it is the script's own business, made where the value is used.
    const result = await validateScript({
      input: {
        type: "object",
        properties: { channel: { type: "string" } },
        required: ["channel"],
      },
      output: {
        type: "object",
        properties: { sentTo: { type: "string" } },
        required: ["sentTo"],
      },
      toolkits: ["slack"],
      run: `async run(input, { slack }) {
  const raw = await slack.sendMessage({ channel_name: input.channel, message: "hi" });
  const sent = z.object({ channel: z.string() }).parse(raw);
  return { sentTo: sent.channel };
}`,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("still refuses to touch an undeclared output that was not narrowed", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { sentTo: { type: "string" } },
        required: ["sentTo"],
      },
      toolkits: ["slack"],
      run: `async run(input, { slack }) {
  const sent = await slack.sendMessage({ channel_name: "#c", message: "hi" });
  return { sentTo: sent.channel };
}`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("TS18046")
  })

  it("turns the submitted JSON Schema into the contract the runtime enforces", async () => {
    const result = await validateScript(
      script(`  log(input.email);`, {
        input: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            count: { type: "integer", minimum: 1 },
          },
          required: ["email"],
        },
      })
    )

    expect(result.contract?.input).toEqual({
      kind: "object",
      fields: {
        email: { spec: { kind: "string", format: "email" }, optional: false },
        count: { spec: { kind: "number", int: true, min: 1 }, optional: true },
      },
    })
  })

  it("assembles a module the author never has to write", async () => {
    const result = await validateScript(script(`  log("hi");`))

    expect(result.source).toContain("defineScript({")
    expect(result.source).not.toContain("import")
    expect(result.source).not.toContain("export")
  })
})

describe("rejects", () => {
  it("a return value the declared output does not allow", async () => {
    // `title` is optional upstream (empty `required_keys`), so it is `string |
    // undefined` — the contract promises `string`.
    const result = await validateScript({
      input: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue: { type: "integer" },
        },
        required: ["owner", "repo", "issue"],
      },
      output: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      toolkits: ["github"],
      run: `async run(input, { github }) {
  const issue = await github.getIssue({
    owner: input.owner, repo: input.repo, issue_number: input.issue,
  });
  return { title: issue.title };
}`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("TS2322")
  })

  it("points diagnostics at the author's own line numbers", async () => {
    const result = await validateScript(
      script(
        `  log("one");\n  await slack.sendMessage({ channel: "#c", message: "hi" });`
      )
    )

    const diagnostic = result.diagnostics.find((d) => d.code === "TS2353")
    // Line 1 is `async run(...) {`, line 2 the log, line 3 the bad call — not the
    // generated preamble's coordinates.
    expect(diagnostic?.start.line).toBe(3)
  })

  it("a misspelled tool argument", async () => {
    const result = await validateScript(
      script(`  await slack.sendMessage({ channel: "#c", message: "hi" });`)
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("TS2353")
  })

  it("a toolkit the context parameter never named", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: ["slack"],
      run: `async run(input, { slack }) {
  await github.whoAmI({});
  return { ok: true };
}`,
    })

    expect(result.ok).toBe(false)
    // Not merely a policy error — the identifier does not exist at all.
    expect(codes(result.diagnostics)).toContain("TS2304")
    expect(Object.values(result.grant)).not.toContain("Github.WhoAmI")
  })

  it("aliasing a toolkit, which would hide the call from grant extraction", async () => {
    const result = await validateScript(
      script(`  const g = github;\n  await g.whoAmI({});`)
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain(
      "policy/toolkit-must-be-called-directly"
    )
  })

  it("computed tool access, for the same reason", async () => {
    const result = await validateScript(
      script(`  await github["who" + "AmI"]({});`)
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("policy/computed-tool-access")
  })

  it("passing a toolkit somewhere the pass cannot follow", async () => {
    const result = await validateScript(
      script(`  const call = (kit) => kit.whoAmI({});\n  await call(github);`)
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain(
      "policy/toolkit-must-be-called-directly"
    )
  })

  it("a rest element, which would grant every toolkit at once", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: ["...everything"],
      run: `async run(input, { ...everything }) {\n  return { ok: true };\n}`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("policy/no-context-rest")
  })

  it("any import at all — a script has nothing to import", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: [],
      run: `async run(input, { log }) {\n  return { ok: true };\n}\n}\nimport { readFileSync } from "node:fs";\n;(() => {`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("policy/no-import")
  })

  it("a `run` that closes itself early and smuggles in statements", async () => {
    // Template injection: the trailing text would become top-level code in the
    // assembled module if splicing were trusted.
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: [],
      run: `async run(input, { log }) { return { ok: true }; }\n});\nconst leaked = 1;\ndefineScript({`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("policy/run-must-be-one-method")
  })

  it.each([
    ["eval", `  log(eval("1+1"));`, "policy/no-eval"],
    [
      "new Function",
      `  log(new Function("return 1")());`,
      "policy/no-function-constructor",
    ],
    ["process", `  log(process.env.ARCADE_API_KEY);`, "policy/no-process"],
    ["globalThis", `  log(globalThis);`, "policy/no-global-this"],
    ["fetch", `  await fetch("https://example.com");`, "policy/no-fetch"],
    [
      "dynamic import",
      `  await import("node:fs");`,
      "policy/no-dynamic-import",
    ],
  ])("reaching for %s", async (_label, body, code) => {
    const result = await validateScript(script(body))
    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain(code)
  })

  it.each([
    ["as any", `  const x = (github as any);`, "policy/no-any-assertion"],
    [
      "a non-null assertion",
      `  const x = input!;`,
      "policy/no-non-null-assertion",
    ],
    [
      "@ts-ignore",
      `  // @ts-ignore\n  const x: number = "no";`,
      "policy/no-suppression",
    ],
  ])("opting out of the checks with %s", async (_label, body, code) => {
    const result = await validateScript(script(body))
    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain(code)
  })

  it("type-level computation, which would let a script slow the checker down", async () => {
    const result = await validateScript(
      script(
        `  type Explode<T> = T extends [infer H, ...infer R] ? [Explode<R>, Explode<R>] : T;`
      )
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("policy/no-type-declaration")
    expect(codes(result.diagnostics)).toContain("policy/no-type-computation")
  })

  it("a context parameter that is not destructured", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      run: `async run(input, ctx) {\n  return { ok: true };\n}`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain(
      "policy/context-must-be-destructured"
    )
  })

  it("a toolkit that does not exist, with a suggestion", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: ["githbu"],
      run: `async run(input, { githbu }) {\n  return { ok: true };\n}`,
    })

    expect(result.ok).toBe(false)
    const diagnostic = result.diagnostics.find(
      (d) => d.code === "contract/unknown-toolkit"
    )
    expect(diagnostic?.message).toContain("github")
  })

  it("a contract that is not usable JSON Schema", async () => {
    const result = await validateScript(
      script(`  log("hi");`, { input: { type: "array" } })
    )

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("contract/invalid-schema")
  })

  it("a `run` larger than the cap", async () => {
    const result = await validateScript(script(`  // ${"x".repeat(70_000)}`))

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toEqual(["policy/source-too-large"])
  })
})

describe("warns", () => {
  it("about a declared toolkit the script never calls", async () => {
    // The guest's tool surface is built from `grant`, not from this list, so a
    // declaration with no matching call grants nothing and should say so.
    const result = await validateScript(script(`  log("hi");`))

    expect(result.ok).toBe(true)
    expect(codes(result.diagnostics)).toContain("contract/unused-toolkit")
  })

  it("does not warn about a toolkit that is declared and used", async () => {
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: ["github"],
      run: `async run(input, { github }) {\n  await github.whoAmI({});\n  return { ok: true };\n}`,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("rejects destructuring a toolkit the body did not declare", async () => {
    // The context type only has the declared toolkits, so the checker catches it —
    // the body and the code cannot disagree about what is in scope.
    const result = await validateScript({
      input: { type: "object", properties: {} },
      output: OK_OUTPUT,
      toolkits: ["github"],
      run: `async run(input, { github, slack }) {\n  await github.whoAmI({});\n  return { ok: true };\n}`,
    })

    expect(result.ok).toBe(false)
    expect(codes(result.diagnostics)).toContain("TS2339")
  })
})
