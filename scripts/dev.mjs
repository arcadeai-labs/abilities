// Runs every app's dev server behind the portless HTTPS proxy under one turbo
// invocation. Each app's `dev:portless` script resolves its own service name, so
// this only needs to echo the resulting URLs up front.
import { spawn } from "node:child_process";
import { portlessName } from "./portless-name.mjs";

const APPS = [
  ["frontend", "returntypes"],
  ["backend", "returntypes-api"],
];

for (const [label, app] of APPS) {
  console.log(`  ${label.padEnd(9)} https://${portlessName(app)}.localhost`);
}
console.log();

const child = spawn("pnpm", ["exec", "turbo", "run", "dev:portless"], { stdio: "inherit" });

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
