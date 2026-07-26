import type { Meta, StoryObj } from "@storybook/react-vite"

import { Label } from "./label"
import { Switch } from "./switch"

const meta = {
  title: "atoms/Switch",
  component: Switch,
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="airplane" defaultChecked />
      <Label htmlFor="airplane">Airplane mode</Label>
    </div>
  ),
}

export const Small: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="small" size="sm" />
      <Label htmlFor="small">Small</Label>
    </div>
  ),
}
