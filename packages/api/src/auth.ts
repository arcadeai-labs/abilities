/**
 * Better Auth BFF for this app.
 *
 * Same model as Arcade's experience-api: the browser only holds httpOnly session
 * cookies; OIDC access tokens live in the DB and are attached as Bearer when we
 * call Arcade upstream. Identity for tool runs is `user.accountId` (= OIDC `sub`).
 *
 * Auth is optional until OIDC env is set — the rest of the API keeps working with
 * a typed-in Arcade user id. Set `AUTH_REQUIRED=true` to refuse unauthenticated
 * runs once login works.
 */
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { genericOAuth } from "better-auth/plugins"
import { z } from "zod"
import * as authSchema from "./auth-schema"
import { db } from "./db"

const OIDC_PROVIDER_ID = "oidc"

/** OIDC userinfo / id-token claims we care about. `sub` may already be `id`. */
const OidcProfileSchema = z
  .object({
    sub: z.coerce.string().min(1).optional(),
    id: z.coerce.string().min(1).optional(),
    email: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough()

const SessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  accountId: z.string().default(""),
  image: z.string().nullish(),
})

function mapOidcProfileToUser(profile: Record<string, unknown>) {
  const parsed = OidcProfileSchema.safeParse(profile)
  if (!parsed.success) return {}
  const { sub, id, email, name } = parsed.data
  const accountId = sub ?? id
  return {
    accountId,
    email,
    name: name ?? email ?? accountId ?? "user",
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.BETTER_AUTH_SECRET &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_DISCOVERY_URL
  )
}

/**
 * Public origin Better Auth issues redirects for. Under `pnpm dev`, portless
 * injects `PORTLESS_URL` (e.g. https://returntypes.localhost); override with
 * `BETTER_AUTH_URL` when that is wrong (preview hosts, standalone API).
 */
export function authBaseURL(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.PORTLESS_URL ??
    "http://localhost:3000"
  )
}

function trustedOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([authBaseURL(), ...fromEnv])]
}

function createAuth() {
  const clientId = process.env.OIDC_CLIENT_ID
  const discoveryUrl = process.env.OIDC_DISCOVERY_URL
  const secret = process.env.BETTER_AUTH_SECRET
  if (!(clientId && discoveryUrl && secret)) {
    throw new Error(
      "Auth is not configured — set BETTER_AUTH_SECRET, OIDC_CLIENT_ID, OIDC_DISCOVERY_URL"
    )
  }

  return betterAuth({
    baseURL: authBaseURL(),
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    trustedOrigins: trustedOrigins(),
    user: {
      additionalFields: {
        // OIDC `sub` — Arcade account UUID. Must allow input here: Better Auth's
        // OAuth path runs additional fields through parseAdditionalUserInputFromProviderProfile,
        // which drops `input: false` keys and then fails required checks.
        accountId: {
          type: "string",
          required: true,
          returned: true,
          input: true,
        },
      },
    },
    advanced: {
      cookiePrefix: "returntypes",
      defaultCookieAttributes: {
        sameSite: process.env.CROSS_SITE_COOKIES === "true" ? "none" : "lax",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            // Ory clients are often registered as client_secret_basic; "post"
            // causes token exchange to 401 and Better Auth surfaces that as
            // oauth_code_verification_failed.
            authentication: "basic",
            clientId,
            clientSecret: process.env.OIDC_CLIENT_SECRET || undefined,
            discoveryUrl,
            scopes: ["openid", "email", "profile", "offline_access"],
            responseType: "code",
            pkce: true,
            overrideUserInfo: true,
            mapProfileToUser: mapOidcProfileToUser,
          },
        ],
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

const AUTH = "__repoAuth" as const

// Drop a cached instance when this module is re-evaluated (Vite HMR), so env /
// provider config changes take effect without a full process restart.
Reflect.deleteProperty(globalThis, AUTH)

/** Lazily built so missing OIDC env does not crash module load. */
export function getAuth(): Auth | null {
  if (!isAuthConfigured()) return null
  const existing: Auth | undefined = Reflect.get(globalThis, AUTH)
  if (existing) return existing
  const created = createAuth()
  Reflect.set(globalThis, AUTH, created)
  return created
}

export type SessionUser = z.infer<typeof SessionUserSchema>

/** Arcade `user_id` for a signed-in user: OIDC `sub`, else email. */
export function arcadeUserId(user: {
  accountId?: string | null
  email?: string | null
}): string | null {
  if (user.accountId) return user.accountId
  if (user.email) return user.email
  return null
}

export async function getSessionUser(
  headers: Headers
): Promise<SessionUser | null> {
  const auth = getAuth()
  if (!auth) return null
  const session = await auth.api.getSession({ headers })
  if (!session?.user) return null
  const parsed = SessionUserSchema.safeParse(session.user)
  return parsed.success ? parsed.data : null
}

/**
 * Prefer the signed-in Arcade identity; fall back to the request body for local
 * runs without OIDC. When `AUTH_REQUIRED=true`, missing session yields null so
 * the route can 401 with a typed error body.
 */
export async function resolveRunUserId(
  headers: Headers,
  bodyUserId: string
): Promise<string | null> {
  const user = await getSessionUser(headers)
  if (user) {
    const id = arcadeUserId(user)
    if (id) return id
  }
  if (process.env.AUTH_REQUIRED === "true") return null
  return bodyUserId
}

export { OIDC_PROVIDER_ID }
