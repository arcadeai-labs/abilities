import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { SidebarProvider } from "@/components/ui/sidebar"
import { ChatPane } from "./chat-pane"
import { ChatComposer, ChatTranscript } from "./chat-panel"
import { sampleConversation } from "./fixtures"

/**
 * Decorators are per story rather than on the meta, because the transcript on its
 * own wants a box to sit in and `InThePane` wants the whole viewport.
 */
const inABox = (Story: () => React.ReactElement) => (
  <div className="flex h-[36rem] max-w-md flex-col p-4">
    <Story />
  </div>
)

const meta = {
  title: "molecules/ChatTranscript",
  component: ChatTranscript,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChatTranscript>

export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {
  args: { messages: sampleConversation },
  decorators: [inABox],
}

export const Empty: Story = {
  args: { messages: [] },
  decorators: [inABox],
}

/**
 * How it actually appears: the whole main pane, in place of the script. The
 * `SidebarProvider` is only there because the pane header carries the rail's
 * trigger.
 */
export const InThePane: Story = {
  args: { messages: sampleConversation },
  decorators: [
    (Story) => (
      <SidebarProvider className="h-svh min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  render: function InThePaneStory(args) {
    const [input, setInput] = useState("")

    return (
      <ChatPane backLabel="Back to summarize-issue" onClose={() => undefined}>
        <ChatTranscript {...args} />
        <ChatComposer
          busy={false}
          onSubmit={() => undefined}
          onValueChange={setInput}
          value={input}
        />
      </ChatPane>
    )
  },
}
