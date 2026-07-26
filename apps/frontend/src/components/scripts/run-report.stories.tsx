import type { Meta, StoryObj } from "@storybook/react-vite"

import { authorizationRequiredRun, failedRun, successfulRun } from "./fixtures"
import { RunReportPanel } from "./run-report"

const meta = {
  title: "molecules/RunReport",
  component: RunReportPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunReportPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Succeeded, and still reports drift — a vendor adding a field is not a failure. */
export const Succeeded: Story = {
  args: { report: successfulRun },
}

export const AuthorizationRequired: Story = {
  args: { report: authorizationRequiredRun },
}

export const ToolFailed: Story = {
  args: { report: failedRun },
}

export const InputRejected: Story = {
  args: {
    report: {
      ...failedRun,
      logs: [],
      toolCalls: [],
      durationMs: 4,
      outcome: {
        kind: "input_invalid",
        violations: [
          { path: "number", message: "Expected integer, received string." },
          { path: "repo", message: "Required." },
        ],
      },
    },
  },
}

export const ContractViolation: Story = {
  args: {
    report: {
      ...successfulRun,
      drift: [],
      outcome: {
        kind: "contract_violation",
        violations: [
          { path: "comments", message: "Expected integer, received null." },
        ],
      },
    },
  },
}

export const LimitExceeded: Story = {
  args: {
    report: {
      ...failedRun,
      outcome: {
        kind: "limit_exceeded",
        limit: "wallClockMs",
        message: "The run exceeded 10000ms and was interrupted.",
      },
    },
  },
}

export const ScriptThrew: Story = {
  args: {
    report: {
      ...failedRun,
      outcome: {
        kind: "script_error",
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'title')",
      },
    },
  },
}
