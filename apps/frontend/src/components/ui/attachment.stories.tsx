import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileIcon } from "lucide-react"

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "./attachment"

const meta = {
  title: "atoms/Attachment",
  component: Attachment,
  tags: ["autodocs"],
} satisfies Meta<typeof Attachment>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Attachment state="done" className="max-w-xs">
      <AttachmentMedia variant="icon">
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>report.pdf</AttachmentTitle>
        <AttachmentDescription>245 KB</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
}

export const Uploading: Story = {
  render: () => (
    <Attachment state="uploading" className="max-w-xs">
      <AttachmentMedia variant="icon">
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>notes.md</AttachmentTitle>
        <AttachmentDescription>Uploading…</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
}
