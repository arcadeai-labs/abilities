import type { Meta, StoryObj } from "@storybook/react-vite"
import { UserIcon } from "lucide-react"

import { Button } from "./button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "./item"

const meta = {
  title: "atoms/Item",
  component: Item,
  tags: ["autodocs"],
} satisfies Meta<typeof Item>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Item variant="outline" className="max-w-md">
      <ItemMedia variant="icon">
        <UserIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Jane Doe</ItemTitle>
        <ItemDescription>Product designer based in SF.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline">
          Follow
        </Button>
      </ItemActions>
    </Item>
  ),
}
