/**
 * Better Auth browser client. Same-origin against this app's `/api/auth/*`
 * (the Hono BFF hosted inside TanStack Start), so cookies ride along and the
 * SPA never sees an OIDC access token.
 */
import {
  genericOAuthClient,
  inferAdditionalFields,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [
    genericOAuthClient(),
    inferAdditionalFields({
      user: {
        accountId: { type: "string", required: true, returned: true },
      },
    }),
  ],
})

export const { useSession, signOut } = authClient

/** Kick off OIDC login against the configured provider (`oidc`). */
export function signInWithOidc(callbackURL = "/") {
  return authClient.signIn.oauth2({
    providerId: "oidc",
    callbackURL,
  })
}

/** Arcade `user_id` from a Better Auth session user. */
export function arcadeUserIdFromSession(user: {
  accountId?: string | null
  email?: string | null
}): string | null {
  if (user.accountId) return user.accountId
  if (user.email) return user.email
  return null
}
