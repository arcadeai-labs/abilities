import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"

const meta = {
  title: "atoms/HoverCard",
  component: HoverCard,
  tags: ["autodocs"],
} satisfies Meta<typeof HoverCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="link" />}>
        @nextjs
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">@nextjs</h4>
          <p className="text-sm text-muted-foreground">
            The React Framework – created and maintained by @vercel.
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
}
