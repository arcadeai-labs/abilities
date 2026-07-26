import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { SidebarProvider } from "@/components/ui/sidebar"
import {
  authorizationRequiredRun,
  failedRun,
  successfulRun,
  summarizeIssue,
  triageInbox,
} from "./fixtures"
import { ScriptRunPane } from "./script-panes"

const noop = () => undefined

/**
 * A script's page. `SidebarProvider` is here only because the pane header carries
 * the rail's trigger.
 */
const meta = {
  title: "layouts/ScriptRunPane",
  component: ScriptRunPane,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    inputJson:
      '{\n  "owner": "arcadeai",\n  "repo": "arcade-ai",\n  "number": 481\n}\n',
    onDelete: noop,
    onInputJsonChange: noop,
    onRun: noop,
    onShowDetails: noop,
    onUserIdChange: noop,
    script: summarizeIssue,
    userId: "anirudh@arcade.dev",
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="h-svh min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof ScriptRunPane>

export default meta
type Story = StoryObj<typeof meta>

/** Editable, so the input's JSON badge reacts to typing. */
export const Ready: Story = {
  render: function ReadyStory(args) {
    const [userId, setUserId] = useState(args.userId)
    const [inputJson, setInputJson] = useState(args.inputJson)

    return (
      <ScriptRunPane
        {...args}
        inputJson={inputJson}
        onInputJsonChange={setInputJson}
        onUserIdChange={setUserId}
        userId={userId}
      />
    )
  },
}

export const Running: Story = {
  args: { running: true },
}

export const Succeeded: Story = {
  args: { report: successfulRun },
}

export const NeedsAuthorization: Story = {
  args: { report: authorizationRequiredRun, script: triageInbox },
}

export const ToolFailed: Story = {
  args: { report: failedRun },
}

export const Rejected: Story = {
  args: { error: "Input must be valid JSON", inputJson: "{ owner: 'x' }" },
}

/** Stale scripts still run; the badge is the only difference here. */
export const Stale: Story = {
  args: { script: triageInbox },
}
