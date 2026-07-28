/**
 * The frame every screen shares: the rail of stored scripts, and the two overlays
 * for the operations that have consequences.
 *
 * Mounted once, by the pathless `_workbench` layout route, so the rail survives
 * navigation. What fills the pane is the child route's business — `/` lists,
 * `/scripts/$name` is that script's run screen, `/chat` hands the pane to the agent.
 *
 * The delete dialog lives here because both of those first two can ask for it. It is
 * also the one action that is navigation: if the script the URL names goes away, so
 * must the URL.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { useAtom } from "jotai"
import { MessageSquareIcon } from "lucide-react"
import type * as React from "react"
import { deleteDialogOpenAtom, deleteTargetAtom } from "@/atoms"
import { AuthStatus } from "@/components/auth-status"
import {
  AppShell,
  AppShellMain,
  AppShellNav,
} from "@/components/layouts/app-shell"
import { ScriptNav } from "@/components/scripts/script-nav"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { useDeleteScript, useScripts } from "@/hooks/api"

export function Workbench({ children }: { children: React.ReactNode }) {
  const scriptsQuery = useScripts()
  const navigate = useNavigate()

  // Undefined off `/scripts/$name`, which is exactly when no row is active.
  const { name } = useParams({ strict: false })

  return (
    <AppShell>
      <AppShellNav>
        <ScriptNav
          error={scriptsQuery.isError ? scriptsQuery.error.message : null}
          footer={
            <div className="flex flex-col gap-2">
              <AuthStatus />
              <Button
                className="w-full justify-start"
                nativeButton={false}
                render={<Link to="/chat" />}
                variant="outline"
              >
                <MessageSquareIcon />
                Ask the agent
              </Button>
              <p className="px-1 text-xs text-muted-foreground">
                Toggle this rail with{" "}
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>B</Kbd>
                </KbdGroup>
              </p>
            </div>
          }
          loading={scriptsQuery.isLoading}
          onSelect={(next) =>
            navigate({ params: { name: next }, to: "/scripts/$name" })
          }
          scripts={scriptsQuery.data?.scripts ?? []}
          selectedName={name ?? null}
        />
      </AppShellNav>

      <AppShellMain>{children}</AppShellMain>

      <DeleteDialog routeName={name ?? null} />
    </AppShell>
  )
}

function DeleteDialog({ routeName }: { routeName: string | null }) {
  const [open, setOpen] = useAtom(deleteDialogOpenAtom)
  const [target, setTarget] = useAtom(deleteTargetAtom)
  const navigate = useNavigate()
  const remove = useDeleteScript()

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) remove.reset()
  }

  const onConfirm = async () => {
    if (!target) return
    await remove.mutateAsync(target)
    setOpen(false)
    // The URL cannot keep naming a script that no longer exists.
    if (target === routeName) {
      await navigate({ to: "/" })
    }
    setTarget(null)
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target}?</AlertDialogTitle>
          <AlertDialogDescription>
            The script and its stored contract go away, and it cannot be run
            again. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending || !target}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm()
            }}
            variant="destructive"
          >
            {remove.isPending ? <Spinner /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
