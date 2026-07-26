import type { Meta, StoryObj } from "@storybook/react-vite"

import { Progress, ProgressLabel, ProgressValue } from "./progress"

const meta = {
  title: "atoms/Progress",
  component: Progress,
  tags: ["autodocs"],
  args: {
    value: 60,
  },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Progress {...args} className="w-full max-w-sm">
      <ProgressLabel>Uploading</ProgressLabel>
      <ProgressValue />
    </Progress>
  ),
}
