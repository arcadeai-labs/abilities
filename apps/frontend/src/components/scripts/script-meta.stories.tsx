import type { Meta, StoryObj } from "@storybook/react-vite"

import { digestReleases, summarizeIssue, triageInbox } from "./fixtures"
import {
  GrantBadges,
  ScriptMetaBar,
  StaleBadge,
  ToolkitBadges,
} from "./script-meta"

const meta = {
  title: "molecules/ScriptMeta",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj

/** Everything about a script that is not its code or its contract, in one band. */
export const MetaBar: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ScriptMetaBar script={summarizeIssue} />
      <ScriptMetaBar script={triageInbox} />
    </div>
  ),
}

/** A current script gets no badge at all — the badge is the exception. */
export const Stale: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <StaleBadge stale={false} />
      <StaleBadge stale={true} />
    </div>
  ),
}

export const Toolkits: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-xs">
      <ToolkitBadges toolkits={digestReleases.toolkits} />
      <ToolkitBadges
        max={2}
        toolkits={["github", "gmail", "linear", "slack", "notion"]}
      />
      <ToolkitBadges toolkits={[]} />
    </div>
  ),
}

/** The upstream tool each alias resolves to rides along as the badge's title. */
export const Grants: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-xs">
      <GrantBadges grant={triageInbox.grant} />
      <GrantBadges grant={digestReleases.grant} />
      <GrantBadges grant={{}} />
    </div>
  ),
}
