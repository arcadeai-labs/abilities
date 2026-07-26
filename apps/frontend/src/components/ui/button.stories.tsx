import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"

const meta = {
  title: "atoms/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    children: "Button",
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Outline: Story = {
  args: {
    variant: "outline",
  },
}

export const Destructive: Story = {
  args: {
    variant: "destructive",
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}
