import type { Meta, StoryObj } from "@storybook/react-vite"

import { digestReleases, summarizeIssue, triageInbox } from "./fixtures"
import { ToolkitScopes } from "./toolkit-scopes"

/** Hover a badge: the scopes are the point, and they come from the calls. */
const meta = {
  title: "molecules/ToolkitScopes",
  component: ToolkitScopes,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-xl p-8 text-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToolkitScopes>

export default meta
type Story = StoryObj<typeof meta>

/** Two granted tools, one scope between them — least privilege, visible. */
export const WithScopes: Story = {
  args: { authorization: triageInbox.authorization },
}

/** Needs a connected account, but the provider declares no scopes per tool. */
export const AuthorizedWithoutScopes: Story = {
  args: { authorization: summarizeIssue.authorization },
}

/** `slack` is declared and never called, so it authorizes nothing. */
export const DeclaredButUnused: Story = {
  args: { authorization: digestReleases.authorization },
}

/** Nothing to authorize: these tools need no account at all. */
export const NoAuthorization: Story = {
  args: {
    authorization: [
      { toolkit: "math", tools: ["math.add"], scopes: [], requiresAuth: false },
    ],
  },
}

export const Several: Story = {
  args: {
    authorization: [
      ...triageInbox.authorization,
      ...digestReleases.authorization,
      {
        toolkit: "googlecalendar",
        tools: ["googlecalendar.listEvents"],
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        requiresAuth: true,
      },
    ],
  },
}

export const None: Story = {
  args: { authorization: [] },
}
