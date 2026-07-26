import type { Meta, StoryObj } from "@storybook/react-vite"

import { Marker, MarkerContent } from "./marker"

const meta = {
  title: "atoms/Marker",
  component: Marker,
  tags: ["autodocs"],
} satisfies Meta<typeof Marker>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-full max-w-md space-y-4">
      <Marker>
        <MarkerContent>Today</MarkerContent>
      </Marker>
      <Marker variant="separator">
        <MarkerContent>Yesterday</MarkerContent>
      </Marker>
      <Marker variant="border">
        <MarkerContent>Last week</MarkerContent>
      </Marker>
    </div>
  ),
}
