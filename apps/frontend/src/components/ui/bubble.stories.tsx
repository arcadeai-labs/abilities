import type { Meta, StoryObj } from "@storybook/react-vite"

import { Bubble, BubbleContent, BubbleGroup } from "./bubble"

const meta = {
  title: "atoms/Bubble",
  component: Bubble,
  tags: ["autodocs"],
} satisfies Meta<typeof Bubble>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <BubbleGroup className="max-w-sm">
      <Bubble variant="secondary">
        <BubbleContent>Hello from the other side.</BubbleContent>
      </Bubble>
      <Bubble align="end">
        <BubbleContent>Hi there!</BubbleContent>
      </Bubble>
      <Bubble variant="outline">
        <BubbleContent>Outline variant</BubbleContent>
      </Bubble>
    </BubbleGroup>
  ),
}
