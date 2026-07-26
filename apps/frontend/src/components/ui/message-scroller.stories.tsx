import type { Meta, StoryObj } from "@storybook/react-vite"

import { Bubble, BubbleContent } from "./bubble"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller"

const meta = {
  title: "atoms/MessageScroller",
  component: MessageScroller,
  tags: ["autodocs"],
} satisfies Meta<typeof MessageScroller>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <MessageScrollerProvider>
      <MessageScroller className="h-[360px] max-w-md rounded-2xl border">
        <MessageScrollerViewport>
          <MessageScrollerContent className="space-y-3 p-4">
            {Array.from({ length: 12 }, (_, i) => (
              <MessageScrollerItem key={i} scrollAnchor={i === 11}>
                <Bubble
                  variant={i % 2 ? "default" : "secondary"}
                  align={i % 2 ? "end" : "start"}
                >
                  <BubbleContent>Message {i + 1}</BubbleContent>
                </Bubble>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
}
