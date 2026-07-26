import type { Meta, StoryObj } from "@storybook/react-vite"

import { NativeSelect, NativeSelectOption } from "./native-select"

const meta = {
  title: "atoms/NativeSelect",
  component: NativeSelect,
  tags: ["autodocs"],
} satisfies Meta<typeof NativeSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <NativeSelect className="w-48" defaultValue="apple">
      <NativeSelectOption value="apple">Apple</NativeSelectOption>
      <NativeSelectOption value="banana">Banana</NativeSelectOption>
      <NativeSelectOption value="orange">Orange</NativeSelectOption>
    </NativeSelect>
  ),
}
