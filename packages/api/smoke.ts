/**
 * Manual end-to-end walk of the scripts API against an in-process Hono app.
 *
 * Not a vitest case — it hits Arcade for a real (or dry) run and prints a
 * narrative. Requires a synced catalog and `ARCADE_API_KEY` for the live step.
 *
 *   pnpm --filter @repo/api smoke
 *
 * Stop the dev server first if PGlite is already locked by it.
 */
import app from "./src/app";
import { closeDb } from "./src/db";

const USER_ID = process.env.ARCADE_USER_ID ?? "anirudh@arcade.dev";

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  return { status: response.status, body: parsed as never, headers: response.headers };
}

const line = (label: string) => console.log(`\n${"═".repeat(74)}\n${label}`);

// ── 1. types ───────────────────────────────────────────────────────────────
line("GET /api/types?toolkit=Github,Slack");
{
  const { status, body, headers } = await call("GET", "/api/types?toolkit=Github,Slack");
  const source = body as unknown as string;
  console.log(`  ${status}  ${headers.get("content-type")}  snapshot=${headers.get("x-catalog-snapshot")}`);
  console.log(`  ${source.split("\n").length} lines, ${(source.length / 1024).toFixed(0)}KiB`);
  console.log(`  ${source.split("\n")[1]}`);
}

// ── 2. coverage ────────────────────────────────────────────────────────────
line("GET /api/coverage");
{
  const { status, body } = await call("GET", "/api/coverage");
  const report = body as unknown as {
    totals: { toolkits: number; tools: number; typed: number };
    curated: { toolkits: number; tools: number; typed: number };
    generated: { toolkits: number; tools: number; typed: number };
    toolkits: { toolkit: string; tools: number; typed: number }[];
  };
  const pct = (t: { tools: number; typed: number }) => `${((100 * t.typed) / t.tools).toFixed(1)}%`;
  console.log(`  ${status}`);
  console.log(`  all       ${report.totals.tools} tools in ${report.totals.toolkits} toolkits → ${pct(report.totals)} typed`);
  console.log(`  curated   ${report.curated.tools} tools in ${report.curated.toolkits} toolkits → ${pct(report.curated)} typed`);
  console.log(`  generated ${report.generated.tools} tools in ${report.generated.toolkits} toolkits → ${pct(report.generated)} typed`);
  console.log(`  best: ${report.toolkits.slice(0, 6).map((t) => `${t.toolkit} ${t.typed}/${t.tools}`).join(", ")}`);
}

// ── 3. validate a broken script ────────────────────────────────────────────
line("POST /api/validate  (a script that lies about its output)");
{
  const { status, body } = await call("POST", "/api/validate", {
    source: `
import { defineScript, z } from "arcade:runtime";
export default defineScript({
  input: z.object({}),
  output: z.object({ login: z.string() }),
  async run(input, { github }) {
    const me = await github.whoAmI({});
    return { login: me.login };
  },
});
`,
  });
  const result = body as unknown as { ok: boolean; grant: string[]; diagnostics: { code: string; message: string; start: { line: number } }[] };
  console.log(`  ${status}  ok=${result.ok}  grant=[${result.grant}]`);
  for (const d of result.diagnostics) console.log(`  ${d.code} @${d.start.line}  ${d.message.slice(0, 140)}`);
}

// ── 4. store a valid one ───────────────────────────────────────────────────
const SOURCE = `
import { defineScript, z } from "arcade:runtime";

export default defineScript({
  input: z.object({}),
  output: z.object({ login: z.string(), greeting: z.string() }),

  async run(input, { github, log }) {
    const me = await github.whoAmI({});
    const login = me.profile?.login ?? "unknown";
    log(\`authenticated as \${login}\`);
    return { login, greeting: "hello, " + login };
  },
});
`;

line("POST /api/scripts  (store)");
let scriptId = "";
{
  const { status, body } = await call("POST", "/api/scripts", { name: "whoami", source: SOURCE });
  const script = body as unknown as { id: string; version: number; grant: string[]; stale: boolean };
  console.log(`  ${status}  id=${script.id} v${script.version} grant=[${script.grant}] stale=${script.stale}`);
  scriptId = script.id;
}

if (!scriptId) {
  // Already exists from a previous run — reuse it.
  const { body } = await call("GET", "/api/scripts");
  const list = body as unknown as { scripts: { id: string; name: string }[] };
  scriptId = list.scripts.find((s) => s.name === "whoami")?.id ?? "";
  console.log(`  reusing existing script ${scriptId}`);
}

// ── 5. run it ──────────────────────────────────────────────────────────────
line(`POST /api/scripts/:id/run  (as ${USER_ID})`);
{
  const { status, body } = await call("POST", `/api/scripts/${scriptId}/run`, {
    input: {},
    userId: USER_ID,
  });
  console.log(`  ${status}  ${JSON.stringify(body).slice(0, 500)}`);
}

// ── 7. rejecting bad input against the declared contract ──────────────────
line("POST /api/scripts/:id/run  (input the contract rejects)");
{
  const { status, body } = await call("POST", `/api/scripts/${scriptId}/run`, {
    input: "not an object",
    userId: USER_ID,
  });
  console.log(`  ${status}  ${JSON.stringify(body).slice(0, 220)}`);
}

// ── 8. revalidate ─────────────────────────────────────────────────────────
line("POST /api/revalidate");
{
  const { status, body } = await call("POST", "/api/revalidate");
  console.log(`  ${status}  ${JSON.stringify(body)}`);
}

// ── 9. openapi document still builds ──────────────────────────────────────
line("GET /api/openapi");
{
  const { status, body } = await call("GET", "/api/openapi");
  const document = body as unknown as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
  console.log(`  ${status}  ${Object.keys(document.paths).length} paths, ${Object.keys(document.components?.schemas ?? {}).length} schemas`);
  console.log(`  ${Object.keys(document.paths).join("  ")}`);
}

await closeDb();
