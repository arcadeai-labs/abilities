/**
 * Sign in via Arcade's IdP (Ory / Coordinator OIDC). Only useful once
 * BETTER_AUTH_SECRET + OIDC_* are set on the server; otherwise the BFF returns
 * 503 and this page says so.
 */
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useAuthConfigured, useSignInOidc } from "@/hooks/api"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const { data: session, isPending } = authClient.useSession()
  const { data: configured = null } = useAuthConfigured()
  const signIn = useSignInOidc()

  useEffect(() => {
    if (session?.user) {
      window.location.replace("/")
    }
  }, [session])

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Scripts</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Uses the same OIDC identity as Arcade. Your browser only keeps a
          session cookie on this app — tool runs use your Arcade account id.
        </p>
      </div>

      {configured === false ? (
        <p className="text-sm text-destructive" role="alert">
          Auth is not configured in this server process. Put{" "}
          <code>OIDC_CLIENT_ID</code>, <code>OIDC_CLIENT_SECRET</code>,{" "}
          <code>OIDC_DISCOVERY_URL</code>, and <code>BETTER_AUTH_SECRET</code>{" "}
          in the workspace <code>.env</code>, then restart <code>pnpm dev</code>{" "}
          (env is only read at startup).
        </p>
      ) : null}

      {isPending ? (
        <p className="text-sm text-muted-foreground">Checking session…</p>
      ) : (
        <Button
          disabled={signIn.isPending || configured === false}
          onClick={() => signIn.mutate("/")}
          size="lg"
        >
          {signIn.isPending ? "Redirecting…" : "Continue with Arcade"}
        </Button>
      )}

      {signIn.error ? (
        <p className="text-sm text-destructive" role="alert">
          {signIn.error.message}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Need to poke around without login?{" "}
        <Link className="underline underline-offset-2" to="/">
          Back to the workbench
        </Link>
        . Auth stays optional until OIDC is configured.
      </p>
    </main>
  )
}
