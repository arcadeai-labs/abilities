import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./chart"

const data = [
  { month: "Jan", desktop: 186 },
  { month: "Feb", desktop: 305 },
  { month: "Mar", desktop: 237 },
  { month: "Apr", desktop: 273 },
  { month: "May", desktop: 209 },
  { month: "Jun", desktop: 214 },
]

const config = {
  desktop: {
    label: "Desktop",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

const meta = {
  title: "atoms/Chart",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <ChartContainer config={config} className="h-[240px] w-full max-w-lg">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          tickMargin={8}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="desktop" fill="var(--color-desktop)" radius={8} />
      </BarChart>
    </ChartContainer>
  ),
}
