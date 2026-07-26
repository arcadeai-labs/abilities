import type { Meta, StoryObj } from "@storybook/react-vite"

import { Alert, AlertDescription, AlertTitle } from "./alert"

const meta = {
  title: "atoms/Alert",
  component: Alert,
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Alert className="max-w-md">
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        You can add components to your app using the cli.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="max-w-md">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please sign in again.
      </AlertDescription>
    </Alert>
  ),
}
