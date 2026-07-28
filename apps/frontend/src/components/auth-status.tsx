/**
 * Session chip in the rail: sign in / out, and mirror the signed-in email into
 * the run-as atom so tool calls use that identity.
 */
import { Link } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useEffect } from "react"
import { userIdAtom } from "@/atoms"
import { Button } from "@/components/ui/button"
import { arcadeUserIdFromSession, authClient, signOut } from "@/lib/auth-client"

export function AuthStatus() {
  const { data: session, isPending } = authClient.useSession()
  const setUserId = useSetAtom(userIdAtom)

  useEffect(() => {
    if (isPending) return
    const id = session?.user ? arcadeUserIdFromSession(session.user) : null
    setUserId(id ?? "")
  }, [session, isPending, setUserId])

  if (isPending) {
    return (
      <p className="px-1 text-xs text-muted-foreground">Checking session…</p>
    )
  }

  if (session?.user) {
    const label =
      session.user.email ||
      arcadeUserIdFromSession(session.user) ||
      session.user.name
    return (
      <div className="flex flex-col gap-2">
        <p
          className="truncate px-1 text-xs text-muted-foreground"
          title={label}
        >
          Signed in as {label}
        </p>
        <Button
          className="w-full"
          onClick={() => void signOut()}
          size="sm"
          variant="outline"
        >
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <Button
      className="w-full"
      nativeButton={false}
      render={<Link to="/login" />}
      size="sm"
      variant="outline"
    >
      Sign in
    </Button>
  )
}
