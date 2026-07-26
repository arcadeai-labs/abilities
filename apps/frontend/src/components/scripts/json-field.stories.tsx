import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { JsonField } from "./json-field"

const schema = `{
  "type": "object",
  "properties": { "owner": { "type": "string" } },
  "required": ["owner"]
}
`

const meta = {
  title: "molecules/JsonField",
  component: JsonField,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JsonField>

export default meta
type Story = StoryObj<typeof meta>

/** Editable: the badge and the Format button follow what is in the box. */
export const Default: Story = {
  args: {
    description: "Validated on every run before the sandbox starts.",
    id: "story-input",
    label: "Input schema",
    onValueChange: () => undefined,
    value: schema,
  },
  render: function DefaultStory(args) {
    const [value, setValue] = useState(args.value)
    return <JsonField {...args} onValueChange={setValue} value={value} />
  },
}

export const Unparseable: Story = {
  args: {
    id: "story-invalid",
    label: "Input schema",
    onValueChange: () => undefined,
    value: '{ "type": "object", ',
  },
}

export const EmptyValue: Story = {
  args: {
    id: "story-empty",
    label: "Output schema",
    onValueChange: () => undefined,
    value: "",
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    id: "story-disabled",
    label: "Input schema",
    onValueChange: () => undefined,
    value: schema,
  },
}
