import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible"

const meta = {
  title: "atoms/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Collapsible className="w-full max-w-sm space-y-2">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-sm font-medium">
          @peduarte starred 3 repositories
        </h4>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
          Toggle
        </CollapsibleTrigger>
      </div>
      <div className="rounded-2xl border px-4 py-2 text-sm">
        @radix-ui/primitives
      </div>
      <CollapsibleContent className="space-y-2">
        <div className="rounded-2xl border px-4 py-2 text-sm">
          @radix-ui/colors
        </div>
        <div className="rounded-2xl border px-4 py-2 text-sm">
          @stitches/react
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
}
