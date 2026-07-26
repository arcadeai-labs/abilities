import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  CopyIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"

import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "./message"

const meta = {
  title: "molecules/Message",
  component: Message,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj

export const User: Story = {
  render: () => (
    <Message from="user">
      <MessageContent>
        <MessageResponse>
          How do I stream tokens with the AI SDK?
        </MessageResponse>
      </MessageContent>
    </Message>
  ),
}

export const Assistant: Story = {
  render: () => (
    <Message from="assistant">
      <MessageContent>
        <MessageResponse>
          {`Use \`useChat\` from \`@ai-sdk/react\` and render each text part with \`MessageResponse\`.

\`\`\`tsx
const { messages } = useChat()
\`\`\`
`}
        </MessageResponse>
      </MessageContent>
    </Message>
  ),
}

export const WithActions: Story = {
  render: () => (
    <Message from="assistant">
      <MessageContent>
        <MessageResponse>
          Here is a short answer you can copy, regenerate, or rate.
        </MessageResponse>
      </MessageContent>
      <MessageToolbar>
        <MessageActions>
          <MessageAction label="Copy" tooltip="Copy">
            <CopyIcon />
          </MessageAction>
          <MessageAction label="Regenerate" tooltip="Regenerate">
            <RefreshCwIcon />
          </MessageAction>
          <MessageAction label="Good response" tooltip="Good response">
            <ThumbsUpIcon />
          </MessageAction>
          <MessageAction label="Bad response" tooltip="Bad response">
            <ThumbsDownIcon />
          </MessageAction>
        </MessageActions>
      </MessageToolbar>
    </Message>
  ),
}

export const Branched: Story = {
  render: () => (
    <Message from="assistant">
      <MessageBranch defaultBranch={0}>
        <MessageBranchContent>
          <MessageContent key="a">
            <MessageResponse>
              First branch: prefer the concise answer.
            </MessageResponse>
          </MessageContent>
          <MessageContent key="b">
            <MessageResponse>
              Second branch: prefer the longer explanation with more context.
            </MessageResponse>
          </MessageContent>
        </MessageBranchContent>
        <MessageToolbar>
          <MessageBranchSelector>
            <MessageBranchPrevious />
            <MessageBranchPage />
            <MessageBranchNext />
          </MessageBranchSelector>
        </MessageToolbar>
      </MessageBranch>
    </Message>
  ),
}

export const Thread: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Message from="user">
        <MessageContent>
          <MessageResponse>
            Summarize atomic design in one sentence.
          </MessageResponse>
        </MessageContent>
      </Message>
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>
            Atomic design builds UIs from atoms into molecules, organisms,
            templates, and pages.
          </MessageResponse>
        </MessageContent>
      </Message>
    </div>
  ),
}
