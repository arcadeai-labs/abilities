import type { Meta, StoryObj } from "@storybook/react-vite"

import { Slider } from "./slider"

const meta = {
  title: "atoms/Slider",
  component: Slider,
  tags: ["autodocs"],
  args: {
    defaultValue: [50],
    max: 100,
    step: 1,
    className: "w-full max-w-sm",
  },
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Range: Story = {
  args: {
    defaultValue: [25, 75],
  },
}
