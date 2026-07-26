// Prints the portless service name for an app, prefixed with the current git
// branch so every branch — and every git worktree, which portless names the same
// way — gets its own stable URL instead of fighting over one.
//
// The default branch is left unprefixed so it keeps the short, memorable URL;
// only side branches need isolating from it.
//
//   node scripts/portless-name.mjs returntypes-api
//     main            -> returntypes-api             (https://returntypes-api.localhost)
//     feat/tools-page -> feat-tools-page.returntypes-api
//     detached HEAD   -> 4a14467.returntypes-api
//     (no git repo)   -> returntypes-api
//
// Each app calls this from its own `dev:portless` script, so running one app
// directly produces the same URL as running everything via `pnpm dev`.
import { execFileSync } from "node:child_process"

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

/** Branch names allow `/`, `_`, `.` and more; hostname labels allow none of them. */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Prefer what the remote calls default; fall back to the usual names. */
const isDefaultBranch = (branch) => {
  const remoteHead = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
  if (remoteHead) return branch === remoteHead.replace(/^origin\//, "")
  return branch === "main" || branch === "master"
}

export function branchLabel() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD")
  if (!branch || isDefaultBranch(branch)) return ""
  // Detached HEAD reports the literal "HEAD"; the short sha identifies it better.
  const label = branch === "HEAD" ? git("rev-parse", "--short", "HEAD") : branch
  return label ? slug(label) : ""
}

export const portlessName = (app) =>
  [branchLabel(), app].filter(Boolean).join(".")

if (import.meta.filename === process.argv[1]) {
  const app = process.argv[2]
  if (!app) {
    console.error("usage: node scripts/portless-name.mjs <app-name>")
    process.exit(1)
  }
  console.log(portlessName(app))
}
