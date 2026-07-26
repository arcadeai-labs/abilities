import type { Meta, StoryObj } from "@storybook/react-vite"

import { Input } from "./input"

const meta = {
  title: "atoms/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    placeholder: "Email",
    type: "email",
    className: "max-w-xs",
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Disabled: Story = {
  args: { disabled: true, placeholder: "Disabled" },
}

export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "not-an-email" },
}
