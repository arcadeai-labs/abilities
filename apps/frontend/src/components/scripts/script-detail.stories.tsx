import type { Meta, StoryObj } from "@storybook/react-vite"

import { addNumbers, summarizeIssue, triageInbox } from "./fixtures"
import { ScriptDetails } from "./script-detail"

/**
 * The sheet's contents, rendered without the sheet — a `Sheet` portals out of the
 * story canvas, and what is worth looking at is the order and the density.
 */
const meta = {
  title: "layouts/ScriptDetails",
  component: ScriptDetails,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto h-svh max-w-3xl overflow-y-auto p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScriptDetails>

export default meta
type Story = StoryObj<typeof meta>

/** Metadata, then the contract as submitted, then the method. */
export const Default: Story = {
  args: { script: summarizeIssue },
}

/** Stale: it still runs, and says what it was checked against. */
export const Stale: Story = {
  args: { script: triageInbox },
}

export const Minimal: Story = {
  args: { script: addNumbers },
}

export const CallsNoTools: Story = {
  args: {
    script: {
      ...addNumbers,
      description: "Reverses a string without leaving the sandbox.",
      grant: {},
      toolkits: [],
      run: 'async run(input) {\n  return { text: [...input.text].reverse().join("") };\n}',
    },
  },
}
