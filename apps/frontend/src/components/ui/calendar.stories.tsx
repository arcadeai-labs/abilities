import type { Meta, StoryObj } from "@storybook/react-vite"
import * as React from "react"

import { Calendar } from "./calendar"

const meta = {
  title: "atoms/Calendar",
  component: Calendar,
  tags: ["autodocs"],
} satisfies Meta<typeof Calendar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: function CalendarStory() {
    const [date, setDate] = React.useState<Date | undefined>(new Date())
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-2xl border"
      />
    )
  },
}
