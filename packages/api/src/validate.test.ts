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

import { describe, expect, it } from "vitest";
import { validateScript } from "./validate";

const script = (body: string, config = "") => `
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  ${config}
  async run(input, { github, slack, log }) {
${body}
    return { ok: true };
  },
});
`;

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

describe("accepts", () => {
  it("a script that conforms to its contract", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input:  z.object({ owner: z.string(), repo: z.string(), issue: z.number().int() }),
  output: z.object({ escalated: z.boolean(), title: z.string() }),
  async run(input, { github, slack, log }) {
    const issue = await github.getIssue({
      owner: input.owner, repo: input.repo, issue_number: input.issue,
    });
    const title = issue.title ?? "(untitled)";
    log(\`issue is \${issue.state}\`);
    if (issue.state === "open") {
      await slack.sendMessage({ channel_name: "#oncall", message: title });
    }
    return { escalated: issue.state === "open", title };
  },
});
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("derives the grant from the destructured context, not from the type", async () => {
    const result = await validateScript(script(`    await github.whoAmI({});`));

    expect(result.ok).toBe(true);
    expect(result.grant).toEqual(["Github.WhoAmI"]);
    expect(result.paths).toEqual({ "github.whoAmI": "Github.WhoAmI" });
  });

  it("reports which granted tools leave their output unspecified", async () => {
    const result = await validateScript(
      script(`    await github.whoAmI({});
    await slack.listUsers({});`),
    );

    expect(result.ok).toBe(true);
    expect(result.outputCoverage).toEqual([
      { path: "github.whoAmI", qualifiedName: "Github.WhoAmI", typed: true },
      { path: "slack.listUsers", qualifiedName: "Slack.ListUsers", typed: false },
    ]);
  });

  it("lets `expect` give an unspecified output a shape", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({ channel: z.string() }),
  output: z.object({ sentTo: z.string() }),
  expect: { "slack.sendMessage": z.object({ channel: z.string() }) },
  async run(input, { slack }) {
    const sent = await slack.sendMessage({ channel_name: input.channel, message: "hi" });
    return { sentTo: sent.channel };
  },
});
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reads the contract out of the source without evaluating it", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({ email: z.string().email(), count: z.number().int().min(1).optional() }),
  output: z.object({ ok: z.boolean() }),
  async run(input, { log }) { log(input.email); return { ok: true }; },
});
`);

    expect(result.contract?.input).toEqual({
      kind: "object",
      fields: {
        email: { spec: { kind: "string", format: "email" }, optional: false },
        count: { spec: { kind: "number", int: true, min: 1 }, optional: true },
      },
    });
  });
});

describe("rejects", () => {
  it("a return value the declared output does not allow", async () => {
    // `title` is optional upstream (empty `required_keys`), so it is `string |
    // undefined` — the contract promises `string`.
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({ owner: z.string(), repo: z.string(), issue: z.number().int() }),
  output: z.object({ title: z.string() }),
  async run(input, { github }) {
    const issue = await github.getIssue({
      owner: input.owner, repo: input.repo, issue_number: input.issue,
    });
    return { title: issue.title };
  },
});
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("TS2322");
  });

  it("a misspelled tool argument", async () => {
    const result = await validateScript(
      script(`    await slack.sendMessage({ channel: "#c", message: "hi" });`),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("TS2353");
  });

  it("a toolkit the context parameter never named", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, { slack }) {
    await github.whoAmI({});
    return { ok: true };
  },
});
`);

    expect(result.ok).toBe(false);
    // Not merely a policy error — the identifier does not exist at all.
    expect(codes(result.diagnostics)).toContain("TS2304");
    expect(result.grant).not.toContain("Github.WhoAmI");
  });

  it("aliasing a toolkit, which would hide the call from grant extraction", async () => {
    const result = await validateScript(
      script(`    const g = github;
    await g.whoAmI({});`),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/toolkit-must-be-called-directly");
  });

  it("computed tool access, for the same reason", async () => {
    const result = await validateScript(
      script(`    await github["who" + "AmI"]({});`),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/computed-tool-access");
  });

  it("passing a toolkit somewhere the pass cannot follow", async () => {
    const result = await validateScript(
      script(`    const call = (kit) => kit.whoAmI({});
    await call(github);`),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/toolkit-must-be-called-directly");
  });

  it("a rest element, which would grant every toolkit at once", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, { ...everything }) { return { ok: true }; },
});
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/no-context-rest");
  });

  it("a second module, which would break the closed module graph", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
import { readFileSync } from "node:fs";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, { log }) { return { ok: true }; },
});
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/no-import");
  });

  it.each([
    ["eval", `    log(eval("1+1"));`, "policy/no-eval"],
    ["new Function", `    log(new Function("return 1")());`, "policy/no-function-constructor"],
    ["process", `    log(process.env.ARCADE_API_KEY);`, "policy/no-process"],
    ["globalThis", `    log(globalThis);`, "policy/no-global-this"],
    ["fetch", `    await fetch("https://example.com");`, "policy/no-fetch"],
    ["dynamic import", `    await import("node:fs");`, "policy/no-dynamic-import"],
  ])("reaching for %s", async (_label, body, code) => {
    const result = await validateScript(script(body));
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(code);
  });

  it.each([
    ["as any", `    const x = (github as any);`, "policy/no-any-assertion"],
    ["a non-null assertion", `    const x = input!;`, "policy/no-non-null-assertion"],
    ["@ts-ignore", `    // @ts-ignore\n    const x: number = "no";`, "policy/no-suppression"],
  ])("opting out of the checks with %s", async (_label, body, code) => {
    const result = await validateScript(script(body));
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(code);
  });

  it("type-level computation, which would let a script slow the checker down", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
type Explode<T> = T extends [infer H, ...infer R] ? [Explode<R>, Explode<R>] : T;
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, { log }) { return { ok: true }; },
});
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/no-type-declaration");
    expect(codes(result.diagnostics)).toContain("policy/no-type-computation");
  });

  it("a context parameter that is not destructured", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, ctx) { return { ok: true }; },
});
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain("policy/context-must-be-destructured");
  });

  it("a toolkit that does not exist, with a suggestion", async () => {
    const result = await validateScript(`
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  async run(input, { githbu }) { return { ok: true }; },
});
`);

    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "policy/unknown-toolkit");
    expect(diagnostic?.message).toContain("github");
  });

  it("a source file larger than the cap", async () => {
    const result = await validateScript(`// ${"x".repeat(70_000)}`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toEqual(["policy/source-too-large"]);
  });
});
