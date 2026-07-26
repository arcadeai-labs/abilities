import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Sidebar, SidebarProvider } from "@/components/ui/sidebar"
import { sampleScripts } from "./fixtures"
import { ScriptNav } from "./script-nav"

const noop = () => undefined

const meta = {
  title: "molecules/ScriptNav",
  component: ScriptNav,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    onSelect: noop,
    scripts: sampleScripts,
    selectedName: null,
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="h-[36rem] min-h-0">
        <Sidebar className="h-full border-r" collapsible="none">
          <Story />
        </Sidebar>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof ScriptNav>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Selected: Story = {
  args: { selectedName: "triage-inbox" },
}

/** Clickable: selection is the only thing this rail does. */
export const Selecting: Story = {
  render: function SelectingStory(args) {
    const [selectedName, setSelectedName] = useState<string | null>(null)
    return (
      <ScriptNav
        {...args}
        onSelect={setSelectedName}
        selectedName={selectedName}
      />
    )
  },
}

export const Loading: Story = {
  args: { loading: true, scripts: [] },
}

export const Failed: Story = {
  args: { error: "Failed to list scripts", scripts: [] },
}

export const Empty: Story = {
  args: { scripts: [] },
}
