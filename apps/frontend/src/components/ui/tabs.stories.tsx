import type { Meta, StoryObj } from "@storybook/react-vite"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

const meta = {
  title: "atoms/Tabs",
  component: Tabs,
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account" className="rounded-2xl border p-4 text-sm">
        Make changes to your account here.
      </TabsContent>
      <TabsContent value="password" className="rounded-2xl border p-4 text-sm">
        Change your password here.
      </TabsContent>
    </Tabs>
  ),
}

export const Line: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4 text-sm">
        Overview content
      </TabsContent>
      <TabsContent value="analytics" className="pt-4 text-sm">
        Analytics content
      </TabsContent>
    </Tabs>
  ),
}
