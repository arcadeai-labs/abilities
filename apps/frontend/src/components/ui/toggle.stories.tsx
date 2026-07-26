import type { Meta, StoryObj } from "@storybook/react-vite"
import { BoldIcon } from "lucide-react"

import { Toggle } from "./toggle"

const meta = {
  title: "atoms/Toggle",
  component: Toggle,
  tags: ["autodocs"],
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Toggle aria-label="Toggle bold">
      <BoldIcon />
    </Toggle>
  ),
}

export const Outline: Story = {
  render: () => (
    <Toggle aria-label="Toggle bold" variant="outline">
      <BoldIcon />
    </Toggle>
  ),
}
