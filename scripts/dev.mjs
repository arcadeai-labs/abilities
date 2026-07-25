// Runs every app's dev server behind the portless HTTPS proxy under one turbo
// invocation. Each app's `dev:portless` script resolves its own service name, so
// this only needs to echo the resulting URLs up front.
//
// The API is not in this list: the frontend serves @repo/api at /api/* from its
// own process. `pnpm --filter @repo/backend serve:portless` runs it standalone.
import { spawn } from "node:child_process";
import { portlessName } from "./portless-name.mjs";

const APPS = [["frontend", "returntypes"]];

for (const [label, app] of APPS) {
  const url = `https://${portlessName(app)}.localhost`;
  console.log(`  ${label.padEnd(9)} ${url}`);
  console.log(`  ${"api".padEnd(9)} ${url}/api  (${url}/api/scalar)`);
}
console.log();

const child = spawn("pnpm", ["exec", "turbo", "run", "dev:portless"], { stdio: "inherit" });

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
