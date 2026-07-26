import type { Meta, StoryObj } from "@storybook/react-vite"

import { Avatar, AvatarFallback } from "./avatar"
import { Bubble, BubbleContent } from "./bubble"
import { Message, MessageAvatar, MessageContent, MessageGroup } from "./message"

const meta = {
  title: "atoms/Message",
  component: Message,
  tags: ["autodocs"],
} satisfies Meta<typeof Message>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <MessageGroup className="max-w-md">
      <Message>
        <MessageAvatar>
          <Avatar size="sm">
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <Bubble variant="secondary">
            <BubbleContent>Hey, how are you?</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <Bubble>
            <BubbleContent>Doing well, thanks!</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageGroup>
  ),
}
