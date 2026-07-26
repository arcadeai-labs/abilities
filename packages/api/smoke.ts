/**
 * Manual end-to-end walk of the scripts API against an in-process Hono app.
 *
 * Not a vitest case — it hits Arcade for real and prints a narrative. `Math` is
 * the fixture because it needs no authorization and its answers are checkable.
 * Requires a synced catalog and `ARCADE_API_KEY`.
 *
 *   pnpm --filter @repo/api smoke
 *
 * Stop the dev server first if PGlite is already locked by it.
 */
import app from "./src/app";
import { closeDb, migrateDb } from "./src/db";

const USER_ID = process.env.ARCADE_USER_ID ?? "anirudh@arcade.dev";
const NAME = "smoke-add";

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

await migrateDb();

/** What an author submits: a method and two schemas. No module, no imports. */
const PARAMS = {
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
};

line("GET /api/types?toolkit=Math   — how you learn what `math` is");
{
  const { status, body, headers } = await call("GET", "/api/types?toolkit=Math");
  const source = body as unknown as string;
  console.log(`  ${status}  snapshot=${headers.get("x-catalog-snapshot")}  ${source.split("\n").length} lines`);
  console.log(`  ${source.split("\n").find((l) => l.includes("add(input:"))?.trim()}`);
  console.log(`  imports in the declarations: ${/^\s*import /m.test(source) ? "yes" : "none"}`);
}

line("GET /api/coverage");
{
  const { status, body } = await call("GET", "/api/coverage");
  const r = body as unknown as {
    totals: { toolkits: number; tools: number; typed: number };
    curated: { tools: number; typed: number };
    generated: { tools: number; typed: number };
  };
  const pct = (t: { tools: number; typed: number }) => `${((100 * t.typed) / t.tools).toFixed(1)}%`;
  console.log(`  ${status}  ${r.totals.tools} tools / ${r.totals.toolkits} toolkits`);
  console.log(`  curated ${pct(r.curated)} typed · generated ${pct(r.generated)} typed`);
}

line("POST /api/validate   — a run that contradicts its own output schema");
{
  const { status, body } = await call("POST", "/api/validate", {
    ...PARAMS,
    output: { type: "object", properties: { sum: { type: "number" } }, required: ["sum"] },
  });
  const r = body as unknown as {
    ok: boolean;
    grant: Record<string, string>;
    diagnostics: { code: string; message: string; start: { line: number } }[];
  };
  console.log(`  ${status}  ok=${r.ok}  grant=${JSON.stringify(r.grant)}`);
  for (const d of r.diagnostics) {
    console.log(`  ${d.code} at run line ${d.start.line}: ${d.message.slice(0, 110)}`);
  }
}

line(`PUT /api/scripts/${NAME}   — upsert, twice`);
{
  const first = await call("PUT", `/api/scripts/${NAME}`, PARAMS);
  const second = await call("PUT", `/api/scripts/${NAME}`, PARAMS);
  const s = second.body as unknown as { version: number; grant: Record<string, string> };
  console.log(`  first ${first.status} (created)   second ${second.status} (replaced, v${s.version})`);
  console.log(`  grant=${JSON.stringify(s.grant)}`);
}

line(`GET /api/scripts/${NAME}   — every aspect, straight from the database`);
{
  const { status, body } = await call("GET", `/api/scripts/${NAME}`);
  const s = body as unknown as Record<string, unknown>;
  console.log(`  ${status}  keys: ${Object.keys(s).join(", ")}`);
  console.log(`  input:  ${JSON.stringify(s.input)}`);
  console.log(`  output: ${JSON.stringify(s.output)}`);
  console.log(`  grant:  ${JSON.stringify(s.grant)}`);
  console.log(`  run[0]: ${String(s.run).split("\n")[0]}`);
}

line(`GET /api/scripts/${NAME}/types   — declarations for just this script's grant`);
{
  const { status, body } = await call("GET", `/api/scripts/${NAME}/types`);
  const source = body as unknown as string;
  console.log(`  ${status}  ${source.split("\n").length} lines, ${(source.length / 1024).toFixed(0)}KiB`);
}

line(`POST /api/scripts/${NAME}/run   — real tools, as ${USER_ID}`);
{
  const { status, body } = await call("POST", `/api/scripts/${NAME}/run`, {
    input: { a: "2", b: "3" },
    userId: USER_ID,
  });
  console.log(`  ${status}  ${JSON.stringify(body).slice(0, 400)}`);
}

line("POST run   — input the contract rejects");
{
  const { status, body } = await call("POST", `/api/scripts/${NAME}/run`, {
    input: { a: 2, b: "3" },
    userId: USER_ID,
  });
  console.log(`  ${status}  ${JSON.stringify((body as { outcome: unknown }).outcome)}`);
}

line("POST /api/revalidate");
{
  const { status, body } = await call("POST", "/api/revalidate");
  console.log(`  ${status}  ${JSON.stringify(body)}`);
}

line("GET /api/openapi");
{
  const { status, body } = await call("GET", "/api/openapi");
  const document = body as unknown as { paths: Record<string, unknown> };
  console.log(`  ${status}  ${Object.keys(document.paths).length} paths`);
  console.log(`  ${Object.keys(document.paths).join("  ")}`);
}

line(`DELETE /api/scripts/${NAME}`);
console.log(`  ${(await call("DELETE", `/api/scripts/${NAME}`)).status}`);

await closeDb();
