/**
 * Dev sign-in: a session with no IdP behind it.
 *
 * `DEV_AUTH=true` hands `/api/auth/*` to this module instead of Better Auth, so
 * everything downstream of a session — the rail's session chip, `GET /api/me`,
 * `resolveRunUserId`, `AUTH_REQUIRED` — is exercisable without registering an OIDC
 * client on Arcade's IdP. The paths and payloads are Better Auth's, which is the
 * point: the browser client needs no dev branch, and neither does anything that
 * reads a session.
 *
 * Signed in is the default and signing out is a cookie, so there is no session
 * store — nothing to migrate, nothing a restart loses, no rows in the auth tables,
 * and no dependency on `BETTER_AUTH_URL` being right for this host.
 *
 * Nothing here authenticates anybody, so the production refusal below is the entire
 * security model. Both it and `DEV_AUTH` are read per call rather than at module
 * load, because the three processes that host this app pick up the workspace `.env`
 * at different times.
 *
 * A Vercel preview is the case this exists for. Its hostname changes per deployment
 * and an OIDC client registers exact redirect URIs, so no preview URL can be
 * pre-registered with the IdP — real login there is a dead end, while the deployment
 * is still not production.
 */
import type { SessionUser } from "./auth"

/** Present means signed out. Absent — the default — means signed in. */
const SIGNED_OUT_COOKIE = "returntypes.dev_signed_out"

/**
 * Fixed rather than derived from the clock: the browser re-polls `get-session` and
 * compares the payload by value, so timestamps that moved would churn the atom.
 */
const ISSUED_AT = new Date(0).toISOString()
const EXPIRES_AT = new Date("2100-01-01T00:00:00.000Z").toISOString()

let warnedInProduction = false

export function devAuthEnabled(): boolean {
  if (process.env.DEV_AUTH !== "true") return false
  if (isProductionDeployment()) {
    if (!warnedInProduction) {
      warnedInProduction = true
      console.warn(
        "DEV_AUTH=true ignored: this is the production deployment. Set OIDC_CLIENT_ID / OIDC_DISCOVERY_URL / BETTER_AUTH_SECRET for real login."
      )
    }
    return false
  }
  return true
}

/**
 * The production *deployment*, which is not the same thing as a production build.
 * Vercel sets `NODE_ENV=production` for preview deployments too, so `NODE_ENV` alone
 * would refuse a dev session exactly where one is wanted. `VERCEL_ENV` distinguishes
 * them (`production` / `preview` / `development`) and wins wherever it exists.
 */
function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production"
  return process.env.NODE_ENV === "production"
}

/**
 * The Arcade end user a dev session runs as. Defaults to `ARCADE_USER_ID` — the
 * same id `smoke.ts` and the test fixtures resolve — so turning dev auth on does
 * not quietly move which account tools execute as.
 */
export function devUserId(): string {
  return (
    process.env.DEV_AUTH_USER ??
    process.env.ARCADE_USER_ID ??
    "anirudh@arcade.dev"
  )
}

/**
 * The session user, or null when signed out.
 *
 * Guarded again here rather than trusting the caller: this is the function that
 * decides somebody is signed in, and it must be impossible for it to say yes in
 * production.
 */
export function devSessionUser(headers: Headers): SessionUser | null {
  if (!devAuthEnabled()) return null
  if (readCookie(headers, SIGNED_OUT_COOKIE)) return null
  const id = devUserId()
  return {
    id: `dev_${id}`,
    // Under real auth this is the OIDC `sub`, and `arcadeUserId()` prefers it —
    // putting the dev id here is what makes tool calls run as that account.
    accountId: id,
    email: id,
    name: "Dev user",
    image: null,
  }
}

/**
 * The three endpoints the Better Auth browser client actually reaches in this app:
 * `useSession()` gets `get-session`, `signOut()` posts `sign-out`, and
 * `signIn.oauth2()` posts `sign-in/oauth2` and follows the `url` that comes back.
 */
export async function devAuthHandler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice("/api/auth".length)
  const secure = url.protocol === "https:"

  if (path === "/get-session") {
    const user = devSessionUser(request.headers)
    return Response.json(user ? sessionPayload(user) : null)
  }

  if (path === "/sign-out") {
    return Response.json(
      { success: true },
      { headers: { "set-cookie": signedOutCookie("1", 31_536_000, secure) } }
    )
  }

  if (path.startsWith("/sign-in")) {
    // Signing back in is deleting the cookie. `redirect` + `url` is the shape the
    // client's redirect plugin and ./hooks/api both follow; the url stays relative
    // because this process cannot know its own public origin (portless proxies it).
    const body: unknown = await request.json().catch(() => null)
    return Response.json(
      { redirect: true, url: callbackPath(body) },
      { headers: { "set-cookie": signedOutCookie("", 0, secure) } }
    )
  }

  return Response.json(
    {
      error: "dev_auth_unsupported",
      message: `DEV_AUTH=true serves only get-session, sign-out and sign-in; ${path} needs a real OIDC client.`,
    },
    { status: 404 }
  )
}

function sessionPayload(user: SessionUser) {
  return {
    session: {
      id: "dev_session",
      token: "dev_session",
      userId: user.id,
      expiresAt: EXPIRES_AT,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT,
    },
    user: {
      ...user,
      emailVerified: true,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT,
    },
  }
}

/**
 * Where to land after signing in — a same-origin path only. An absolute
 * `callbackURL` would make this an open redirect, and `//host` is absolute too.
 */
function callbackPath(body: unknown): string {
  const value =
    body && typeof body === "object" && "callbackURL" in body
      ? body.callbackURL
      : null
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value
}

function signedOutCookie(value: string, maxAge: number, secure: boolean) {
  return [
    `${SIGNED_OUT_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "HttpOnly",
    // Omitted under `pnpm dev:ports`, which serves plain http on a raw port.
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
}

/** Empty counts as absent, so a cookie a browser kept after `Max-Age=0` is ignored. */
function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get("cookie")
  if (!header) return null
  for (const pair of header.split(";")) {
    const trimmed = pair.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1) || null
    }
  }
  return null
}
