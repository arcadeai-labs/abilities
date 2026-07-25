// Runs every app's dev server behind the portless HTTPS proxy, under one turbo
// invocation. The per-branch subdomain base is exported as PORTLESS_BASE; each
// app's `dev:portless` script prefixes its own name onto it.
import { spawn } from "node:child_process";
import { portlessBase } from "./portless-base.mjs";

const base = portlessBase();

console.log(`portless base: ${base}`);
console.log(`  frontend  https://${base}.localhost`);
console.log(`  backend   https://api.${base}.localhost\n`);

const child = spawn("pnpm", ["exec", "turbo", "run", "dev:portless"], {
  stdio: "inherit",
  env: { ...process.env, PORTLESS_BASE: base },
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
