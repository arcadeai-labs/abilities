// Computes the portless subdomain base for this checkout.
//
// The base is "<branch>.returntypes" so every branch — and every git worktree,
// which portless names the same way — gets its own stable URL instead of
// fighting over one. Outside a git repo it degrades to plain "returntypes".
//
//   main            -> https://main.returntypes.localhost
//                      https://api.main.returntypes.localhost
//   feat/tools-page -> https://feat-tools-page.returntypes.localhost
//                      https://api.feat-tools-page.returntypes.localhost
//
// Run directly (`node scripts/portless-base.mjs`) to print the current base.
import { execFileSync } from "node:child_process";

export const PROJECT = "returntypes";

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

/** Branch names allow `/`, `_`, `.` and more; hostname labels allow none of them. */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function portlessBase() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  // Detached HEAD reports the literal "HEAD"; the short sha identifies it better.
  const label = branch === "HEAD" ? git("rev-parse", "--short", "HEAD") : branch;
  return [label && slug(label), PROJECT].filter(Boolean).join(".");
}

if (import.meta.filename === process.argv[1]) console.log(portlessBase());
