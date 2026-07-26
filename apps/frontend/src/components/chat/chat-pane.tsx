/**
 * The agent as a third thing the main pane can be, in place of the script.
 *
 * It takes the pane rather than opening a column beside it: writing a script is
 * what you are doing while you are doing it, and half a screen of chat next to half
 * a screen of code serves neither. The rail keeps the list, so getting back to a
 * script is one click either way.
 *
 * Shaped like the panes in `components/scripts` — a header and a body for
 * `AppShellMain` to hold — so all three are interchangeable at the same mount point.
 */
import { MessageSquareIcon, XIcon } from "lucide-react"
import type * as React from "react"
import {
  AppShellActions,
  AppShellBody,
  AppShellHeader,
  AppShellHeading,
  AppShellSubtitle,
  AppShellTitle,
} from "@/components/layouts/app-shell"
import { Button } from "@/components/ui/button"

function ChatPane({
  onClose,
  backLabel = "Close",
  children,
}: {
  onClose: () => void
  /** What closing returns to, so the way out names its destination. */
  backLabel?: string
  children: React.ReactNode
}) {
  return (
    <>
      <AppShellHeader>
        <AppShellHeading>
          <AppShellTitle>
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            Agent
          </AppShellTitle>
          <AppShellSubtitle>
            It has the whole API as tools: it writes a script, validates it
            against the catalog and stores it only if it checks.
          </AppShellSubtitle>
        </AppShellHeading>
        <AppShellActions>
          <Button onClick={onClose} variant="outline">
            <XIcon />
            {backLabel}
          </Button>
        </AppShellActions>
      </AppShellHeader>

      {/* The transcript owns its own scrolling, so the body must not add any. */}
      <AppShellBody className="flex flex-col overflow-hidden p-4">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          {children}
        </div>
      </AppShellBody>
    </>
  )
}

export { ChatPane }
