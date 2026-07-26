import type { Meta, StoryObj } from "@storybook/react-vite"

import { Spinner } from "./spinner"

const meta = {
  title: "atoms/Spinner",
  component: Spinner,
  tags: ["autodocs"],
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Large: Story = {
  args: {
    className: "size-8",
  },
}
