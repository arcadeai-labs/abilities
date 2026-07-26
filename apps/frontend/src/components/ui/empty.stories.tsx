import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxIcon } from "lucide-react"

import { Button } from "./button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty"

const meta = {
  title: "atoms/Empty",
  component: Empty,
  tags: ["autodocs"],
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Empty className="max-w-md border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          You have not created any projects. Get started by creating one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Create project</Button>
      </EmptyContent>
    </Empty>
  ),
}
