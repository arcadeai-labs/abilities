/**
 * The agent, in the pane the script was in.
 *
 * Closing goes back rather than to a fixed place, so arriving from a script returns
 * to that script — the rail is the fallback when there is no history to go back to,
 * which is the case for a cold load of `/chat`.
 */
import {
  createFileRoute,
  useCanGoBack,
  useRouter,
} from "@tanstack/react-router"
import { ChatPane } from "@/components/chat/chat-pane"
import { ChatPanel } from "@/components/chat/chat-panel"

export const Route = createFileRoute("/_workbench/chat")({ component: Chat })

function Chat() {
  const router = useRouter()
  const canGoBack = useCanGoBack()

  return (
    <ChatPane
      backLabel={canGoBack ? "Back" : "Back to scripts"}
      onClose={() => {
        if (canGoBack) {
          router.history.back()
          return
        }
        void router.navigate({ to: "/" })
      }}
    >
      <ChatPanel />
    </ChatPane>
  )
}
