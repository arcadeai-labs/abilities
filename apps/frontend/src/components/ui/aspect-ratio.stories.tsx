import type { Meta, StoryObj } from "@storybook/react-vite"

import { AspectRatio } from "./aspect-ratio"

const meta = {
  title: "atoms/AspectRatio",
  component: AspectRatio,
  tags: ["autodocs"],
  args: {
    ratio: 16 / 9,
  },
} satisfies Meta<typeof AspectRatio>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-full max-w-sm overflow-hidden rounded-2xl">
      <AspectRatio {...args} className="bg-muted">
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          16:9
        </div>
      </AspectRatio>
    </div>
  ),
}
