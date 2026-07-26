import app from "./src/app";
import { closeDb } from "./src/db";
for (const p of ["/api/scalar", "/api/openapi", "/api/scripts", "/api/coverage"]) {
  const r = await app.request(p);
  const body = await r.text();
  console.log(`${String(r.status).padEnd(4)} ${p.padEnd(16)} ${r.headers.get("content-type")?.slice(0, 30)}  ${body.length}B`);
  if (r.status >= 400) console.log(`     ${body.slice(0, 400)}`);
}
await closeDb();
