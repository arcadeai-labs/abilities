import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"
import { toast, Toaster } from "./toast"

const meta = {
  title: "atoms/Toast",
  component: Toaster,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <>
        <Toaster />
        <Story />
      </>
    ),
  ],
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.add({ title: "Scheduled", description: "Friday, 2:00 PM" })
        }
      >
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.add({ title: "Saved", type: "success" })}
      >
        Success
      </Button>
      <Button
        variant="destructive"
        onClick={() =>
          toast.add({ title: "Something went wrong", type: "error" })
        }
      >
        Error
      </Button>
    </div>
  ),
}
