import type { Meta, StoryObj } from "@storybook/react-vite"
import type { UIMessage } from "ai"
import { MessageSquareIcon } from "lucide-react"

import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./conversation"
import { Message, MessageContent, MessageResponse } from "./message"

const sampleMessages: UIMessage[] = [
  {
    id: "1",
    role: "user",
    parts: [{ type: "text", text: "What is a molecule in atomic design?" }],
  },
  {
    id: "2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "A molecule is a group of atoms working together as a simple UI unit — like a search field with a button.",
      },
    ],
  },
  {
    id: "3",
    role: "user",
    parts: [{ type: "text", text: "And organisms?" }],
  },
  {
    id: "4",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Organisms combine molecules into relatively complex sections of an interface, such as a header or chat transcript.",
      },
    ],
  },
]

const meta = {
  title: "molecules/Conversation",
  component: Conversation,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto flex h-[28rem] w-full max-w-xl flex-col border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj

export const Empty: Story = {
  render: () => (
    <Conversation>
      <ConversationContent>
        <ConversationEmptyState
          description="Start a conversation to see messages here"
          icon={<MessageSquareIcon className="size-8" />}
          title="No messages yet"
        />
      </ConversationContent>
    </Conversation>
  ),
}

export const WithMessages: Story = {
  render: () => (
    <Conversation>
      <ConversationContent>
        {sampleMessages.map((message) => (
          <Message from={message.role} key={message.id}>
            <MessageContent>
              {message.parts.map((part, index) =>
                part.type === "text" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: demo parts have no id
                  <MessageResponse key={index}>{part.text}</MessageResponse>
                ) : null
              )}
            </MessageContent>
          </Message>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  ),
}

export const WithDownload: Story = {
  render: () => (
    <Conversation>
      <ConversationDownload messages={sampleMessages} />
      <ConversationContent>
        {sampleMessages.map((message) => (
          <Message from={message.role} key={message.id}>
            <MessageContent>
              {message.parts.map((part, index) =>
                part.type === "text" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: demo parts have no id
                  <MessageResponse key={index}>{part.text}</MessageResponse>
                ) : null
              )}
            </MessageContent>
          </Message>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  ),
}
