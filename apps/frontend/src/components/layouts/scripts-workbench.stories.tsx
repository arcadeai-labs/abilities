/**
 * The whole screen, assembled the same way `components/scripts-app.tsx` assembles
 * it — `AppShell` around the rail and one of the three panes, with the run panel
 * over the top. The only difference is where the state comes from: local `useState` and
 * the fixtures instead of jotai and the RPC client.
 *
 * That is the point of the collection: every state of this screen is reachable
 * here, including the ones that need a server behaving badly.
 *
 * Two things stand in for what the app has and a story cannot: `useState` plays the
 * router, so `chatOpen` is a prop here where the app has a `/chat` route and the
 * rail's button is a `Link`; and the rail shows a fixture transcript rather than a
 * live `ChatPanel`, because there is no agent to talk to.
 */
import type { Meta, StoryObj } from "@storybook/react-vite"
import { MessageSquareIcon } from "lucide-react"
import { useState } from "react"

import { ChatPane } from "@/components/chat/chat-pane"
import { ChatComposer, ChatTranscript } from "@/components/chat/chat-panel"
import { sampleConversation } from "@/components/chat/fixtures"
import {
  authorizationRequiredRun,
  failedRun,
  sampleScripts,
  successfulRun,
} from "@/components/scripts/fixtures"
import { ScriptDetailsSheet } from "@/components/scripts/script-detail"
import { ScriptNav } from "@/components/scripts/script-nav"
import { BrowsePane, ScriptRunPane } from "@/components/scripts/script-panes"
import type { RunReportView, ScriptView } from "@/components/scripts/types"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { AppShell, AppShellMain, AppShellNav } from "./app-shell"

const SNAPSHOT = "snap_2026_07_24"

type WorkbenchProps = {
  scripts?: ScriptView[]
  selected?: string | null
  loading?: boolean
  loadError?: string | null
  running?: boolean
  runError?: string | null
  report?: RunReportView | null
  detailsOpen?: boolean
  chatOpen?: boolean
}

/**
 * Selection, the run panel and what the rail holds are all live, so the screen can
 * be clicked through from any of these starting points.
 */
function Workbench({
  scripts = sampleScripts,
  selected = null,
  loading = false,
  loadError = null,
  running = false,
  runError = null,
  report = null,
  detailsOpen = false,
  chatOpen = false,
}: WorkbenchProps) {
  const [selectedName, setSelectedName] = useState<string | null>(selected)
  const [sheetOpen, setSheetOpen] = useState(detailsOpen)
  const [chatVisible, setChatVisible] = useState(chatOpen)
  const [prompt, setPrompt] = useState("")
  const [userId, setUserId] = useState("anirudh@arcade.dev")
  const [inputJson, setInputJson] = useState(
    '{\n  "owner": "arcadeai",\n  "repo": "arcade-ai",\n  "number": 481\n}\n'
  )

  const script = scripts.find((entry) => entry.name === selectedName) ?? null
  const noop = () => undefined

  return (
    <AppShell>
      <AppShellNav>
        <ScriptNav
          error={loadError}
          footer={
            <div className="flex flex-col gap-2">
              <Button
                className="w-full justify-start"
                onClick={() => setChatVisible(!chatVisible)}
                variant={chatVisible ? "secondary" : "outline"}
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
          loading={loading}
          onSelect={(name) => {
            setSelectedName(name)
            setChatVisible(false)
          }}
          scripts={scripts}
          selectedName={chatVisible ? null : selectedName}
        />
      </AppShellNav>

      <AppShellMain>
        {chatVisible ? (
          <ChatPane
            backLabel={script ? `Back to ${script.name}` : "Back to scripts"}
            onClose={() => setChatVisible(false)}
          >
            <ChatTranscript messages={sampleConversation} />
            <ChatComposer
              busy={false}
              onSubmit={noop}
              onValueChange={setPrompt}
              value={prompt}
            />
          </ChatPane>
        ) : script ? (
          <ScriptRunPane
            error={runError}
            inputJson={inputJson}
            onDelete={noop}
            onInputJsonChange={setInputJson}
            onRun={noop}
            onShowDetails={() => setSheetOpen(true)}
            onUserIdChange={setUserId}
            report={report}
            running={running}
            script={script}
            userId={userId}
          />
        ) : (
          <BrowsePane
            error={loadError}
            loading={loading}
            onDelete={noop}
            onOpen={setSelectedName}
            scripts={scripts}
            snapshotId={SNAPSHOT}
          />
        )}
      </AppShellMain>

      {script ? (
        <ScriptDetailsSheet
          onOpenChange={setSheetOpen}
          open={sheetOpen}
          script={script}
        />
      ) : null}
    </AppShell>
  )
}

const meta = {
  title: "layouts/ScriptsWorkbench",
  component: Workbench,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Workbench>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing selected: the list is the landing page, not an empty state. */
export const Browsing: Story = {}

/** A script's page is its run screen: fill in the input and go. */
export const Reading: Story = {
  args: { selected: "summarize-issue" },
}

/** Stale means the catalog moved, not that the script is broken. */
export const ReadingStale: Story = {
  args: { selected: "triage-inbox" },
}

/**
 * The agent in place of the script. The rail still lists everything, so the way
 * back is either the header button or picking a script.
 */
export const WithAgent: Story = {
  args: { chatOpen: true, selected: "summarize-issue" },
}

export const Running: Story = {
  args: { running: true, selected: "summarize-issue" },
}

export const RunSucceeded: Story = {
  args: { report: successfulRun, selected: "summarize-issue" },
}

export const RunNeedsAuthorization: Story = {
  args: { report: authorizationRequiredRun, selected: "triage-inbox" },
}

export const RunFailed: Story = {
  args: { report: failedRun, selected: "add-numbers" },
}

export const RunRejected: Story = {
  args: { runError: "Input must be valid JSON", selected: "add-numbers" },
}

/** The contract and the method, one click behind the run screen. */
export const WithDetailsSheet: Story = {
  args: { detailsOpen: true, selected: "summarize-issue" },
}

export const Loading: Story = {
  args: { loading: true, scripts: [] },
}

/** Nothing stored, so the empty state points at the agent. */
export const NoScripts: Story = {
  args: { scripts: [] },
}

export const LoadFailed: Story = {
  args: { loadError: "Failed to list scripts", scripts: [] },
}
