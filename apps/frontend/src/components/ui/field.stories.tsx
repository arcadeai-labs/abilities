import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./field"
import { Input } from "./input"

const meta = {
  title: "atoms/Field",
  component: Field,
  tags: ["autodocs"],
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="username">Username</FieldLabel>
        <Input id="username" placeholder="shadcn" />
        <FieldDescription>This is your public display name.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" type="email" aria-invalid defaultValue="bad@" />
        <FieldError>Enter a valid email address.</FieldError>
      </Field>
    </FieldGroup>
  ),
}
