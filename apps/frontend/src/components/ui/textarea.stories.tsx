import type { Meta, StoryObj } from "@storybook/react-vite"

import { Textarea } from "./textarea"

const meta = {
  title: "atoms/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: {
    placeholder: "Type your message here.",
    className: "max-w-sm",
  },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Disabled: Story = {
  args: { disabled: true },
}
