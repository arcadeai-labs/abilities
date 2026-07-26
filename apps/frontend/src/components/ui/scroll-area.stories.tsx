import type { Meta, StoryObj } from "@storybook/react-vite"

import { ScrollArea } from "./scroll-area"
import { Separator } from "./separator"

const tags = Array.from({ length: 50 }, (_, i) => `v1.2.0-beta.${i + 1}`)

const meta = {
  title: "atoms/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-2xl border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium">Tags</h4>
        {tags.map((tag) => (
          <div key={tag}>
            <div className="text-sm">{tag}</div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}
