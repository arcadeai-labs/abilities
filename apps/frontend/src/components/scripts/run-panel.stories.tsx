import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { authorizationRequiredRun, successfulRun } from "./fixtures"
import { RunPanel } from "./run-panel"

const noop = () => undefined

const meta = {
  title: "molecules/RunPanel",
  component: RunPanel,
  tags: ["autodocs"],
  args: {
    inputJson:
      '{\n  "owner": "arcadeai",\n  "repo": "arcade-ai",\n  "number": 481\n}\n',
    onInputJsonChange: noop,
    userId: "anirudh@arcade.dev",
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  render: function EmptyStory(args) {
    const [inputJson, setInputJson] = useState(args.inputJson)

    return (
      <RunPanel
        {...args}
        inputJson={inputJson}
        onInputJsonChange={setInputJson}
      />
    )
  },
}

export const Running: Story = {
  args: { disabled: true },
}

export const Rejected: Story = {
  args: {
    error: "Input must be valid JSON",
    inputJson: "{ owner: 'arcadeai' }",
  },
}

export const Succeeded: Story = {
  args: { report: successfulRun },
}

export const NeedsAuthorization: Story = {
  args: { report: authorizationRequiredRun },
}
