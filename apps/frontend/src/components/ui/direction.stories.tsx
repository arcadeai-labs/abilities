import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import { DirectionProvider } from "./direction"

const meta = {
  title: "atoms/Direction",
  component: DirectionProvider,
  tags: ["autodocs"],
} satisfies Meta<typeof DirectionProvider>

export default meta
type Story = StoryObj<typeof meta>

export const Rtl: Story = {
  render: () => (
    <DirectionProvider direction="rtl">
      <div
        dir="rtl"
        className="flex max-w-sm flex-col gap-3 rounded-2xl border p-4"
      >
        <p className="text-sm">This content is rendered in RTL direction.</p>
        <Button>زر الإجراء</Button>
      </div>
    </DirectionProvider>
  ),
}
