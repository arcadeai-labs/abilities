// Registers this worktree's portless OIDC callback on the Ory OAuth2 client so
// login works without hand-editing redirect URIs for every branch.
//
// Requires ORY_PROJECT_ID (Ory Network project slug or UUID) and OIDC_CLIENT_ID.
// No-ops when either is unset, or when the `ory` CLI is missing / unauthenticated.
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { portlessName } from "./portless-name.mjs"

const CALLBACK_PATH = "/api/auth/oauth2/callback/oidc"

/** Fields Hydra rejects or ignores on replace — strip before --file update. */
const READ_ONLY = new Set([
  "AdditionalProperties",
  "created_at",
  "updated_at",
  "client_secret_expires_at",
])

function warn(msg) {
  console.warn(`  ory: ${msg}`)
}

function ory(args, { quiet = false } = {}) {
  const result = spawnSync("ory", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) {
    if (result.error.code === "ENOENT") {
      return {
        ok: false,
        error: "ory CLI not found — install it or skip ORY_PROJECT_ID",
      }
    }
    return { ok: false, error: result.error.message }
  }
  if (result.status !== 0) {
    const err = (
      result.stderr ||
      result.stdout ||
      `ory exited ${result.status}`
    ).trim()
    return { ok: false, error: quiet ? err.split("\n")[0] : err }
  }
  return { ok: true, stdout: result.stdout }
}

export function redirectUriForFrontend() {
  return `https://${portlessName("returntypes")}.localhost${CALLBACK_PATH}`
}

/**
 * Ensure `redirectUri` is on the OAuth2 client. Returns true when the client
 * already had it or the update succeeded.
 */
export function ensureOryRedirectUri({
  projectId = process.env.ORY_PROJECT_ID,
  clientId = process.env.OIDC_CLIENT_ID,
  redirectUri = redirectUriForFrontend(),
} = {}) {
  if (!(projectId && clientId)) return false

  const got = ory(
    [
      "get",
      "oauth2-client",
      clientId,
      "--project",
      projectId,
      "--format",
      "json",
    ],
    { quiet: true }
  )
  if (!got.ok) {
    warn(`could not read client: ${got.error}`)
    return false
  }

  let client
  try {
    client = JSON.parse(got.stdout)
  } catch {
    warn("could not parse ory get oauth2-client output")
    return false
  }

  const existing = Array.isArray(client.redirect_uris)
    ? client.redirect_uris
    : []
  if (existing.includes(redirectUri)) {
    console.log(`  ory      redirect URI already registered`)
    console.log(`           ${redirectUri}`)
    return true
  }

  const next = {
    ...Object.fromEntries(
      Object.entries(client).filter(([k]) => !READ_ONLY.has(k))
    ),
    redirect_uris: [...existing, redirectUri],
  }
  // Prefer env secret so a replace cannot blank the stored one.
  if (process.env.OIDC_CLIENT_SECRET) {
    next.client_secret = process.env.OIDC_CLIENT_SECRET
  }

  const dir = mkdtempSync(join(tmpdir(), "ory-redirect-"))
  const file = join(dir, "client.json")
  try {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    const updated = ory(
      [
        "update",
        "oauth2-client",
        clientId,
        "--project",
        projectId,
        "--file",
        file,
        "--format",
        "json",
        "-y",
      ],
      { quiet: true }
    )
    if (!updated.ok) {
      warn(`could not update client: ${updated.error}`)
      return false
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`  ory      registered redirect URI`)
  console.log(`           ${redirectUri}`)
  return true
}

if (import.meta.filename === process.argv[1]) {
  const ok = ensureOryRedirectUri()
  process.exit(
    ok || !(process.env.ORY_PROJECT_ID && process.env.OIDC_CLIENT_ID) ? 0 : 1
  )
}
