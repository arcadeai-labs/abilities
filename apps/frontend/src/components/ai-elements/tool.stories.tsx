import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./tool"

const meta = {
  title: "molecules/Tool",
  component: Tool,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj

export const Completed: Story = {
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state="output-available" type="tool-get_weather" />
      <ToolContent>
        <ToolInput input={{ city: "Tel Aviv", units: "metric" }} />
        <ToolOutput
          errorText={undefined}
          output={{ temperature: 28, condition: "Clear" }}
        />
      </ToolContent>
    </Tool>
  ),
}

export const Running: Story = {
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state="input-available" type="tool-search_docs" />
      <ToolContent>
        <ToolInput input={{ query: "atomic design molecules", limit: 5 }} />
        <ToolOutput errorText={undefined} output={undefined} />
      </ToolContent>
    </Tool>
  ),
}

export const Pending: Story = {
  render: () => (
    <Tool>
      <ToolHeader state="input-streaming" type="tool-list_files" />
      <ToolContent>
        <ToolInput input={{ path: "apps/frontend/src" }} />
      </ToolContent>
    </Tool>
  ),
}

export const Error: Story = {
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state="output-error" type="tool-read_file" />
      <ToolContent>
        <ToolInput input={{ path: "/missing/file.ts" }} />
        <ToolOutput errorText="ENOENT: no such file or directory" output={undefined} />
      </ToolContent>
    </Tool>
  ),
}

export const DynamicTool: Story = {
  render: () => (
    <Tool defaultOpen>
      <ToolHeader
        state="output-available"
        toolName="lookup_script"
        type="dynamic-tool"
      />
      <ToolContent>
        <ToolInput input={{ id: "script_123" }} />
        <ToolOutput
          errorText={undefined}
          output={{ name: "onboarding-email", status: "draft" }}
        />
      </ToolContent>
    </Tool>
  ),
}

export const AwaitingApproval: Story = {
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state="approval-requested" type="tool-send_email" />
      <ToolContent>
        <ToolInput
          input={{ to: "user@example.com", subject: "Welcome", body: "Hello!" }}
        />
      </ToolContent>
    </Tool>
  ),
}
