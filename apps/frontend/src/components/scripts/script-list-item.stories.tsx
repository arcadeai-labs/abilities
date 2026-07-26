import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  addNumbers,
  digestReleases,
  sampleScripts,
  triageInbox,
} from "./fixtures"
import { ScriptListItem } from "./script-list-item"

const noop = () => undefined

const meta = {
  title: "molecules/ScriptListItem",
  component: ScriptListItem,
  tags: ["autodocs"],
  args: {
    onDelete: noop,
    onOpen: noop,
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScriptListItem>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { script: digestReleases },
}

export const Stale: Story = {
  args: { script: triageInbox },
}

export const WithoutDescription: Story = {
  args: { script: addNumbers },
}

export const List: Story = {
  args: { script: digestReleases },
  render: (args) => (
    <div className="grid gap-3">
      {sampleScripts.map((script) => (
        <ScriptListItem {...args} key={script.id} script={script} />
      ))}
    </div>
  ),
}
