import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  AppShell,
  AppShellActions,
  AppShellBody,
  AppShellFooter,
  AppShellHeader,
  AppShellHeading,
  AppShellMain,
  AppShellNav,
  AppShellSubtitle,
  AppShellTitle,
} from "./app-shell"

const meta = {
  title: "layouts/AppShell",
  component: AppShell,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

function Nav() {
  return (
    <>
      <SidebarHeader className="p-3">
        <span className="font-heading text-sm font-medium">Workspace</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Sections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {["Overview", "Scripts", "Runs"].map((item, index) => (
                <SidebarMenuItem key={item}>
                  <SidebarMenuButton isActive={index === 1}>
                    {item}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  )
}

function Filler({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => `row-${index}`).map((key) => (
        <div className="h-20 rounded-2xl border bg-card" key={key} />
      ))}
    </div>
  )
}

/** The rail, a header that stays put, and a body that owns the only scroll. */
export const Default: Story = {
  render: () => (
    <AppShell>
      <AppShellNav>
        <Nav />
      </AppShellNav>
      <AppShellMain>
        <AppShellHeader>
          <AppShellHeading>
            <AppShellTitle>Scripts</AppShellTitle>
            <AppShellSubtitle>
              Catalog snapshot snap_2026_07_24
            </AppShellSubtitle>
          </AppShellHeading>
          <AppShellActions>
            <Button>
              <PlusIcon />
              New script
            </Button>
          </AppShellActions>
        </AppShellHeader>
        <AppShellBody>
          <Filler rows={12} />
        </AppShellBody>
      </AppShellMain>
    </AppShell>
  ),
}

/** With a commit bar: it sits outside the scroll, so it never scrolls away. */
export const WithFooter: Story = {
  render: () => (
    <AppShell>
      <AppShellNav>
        <Nav />
      </AppShellNav>
      <AppShellMain>
        <AppShellHeader>
          <AppShellHeading>
            <AppShellTitle>New script</AppShellTitle>
            <AppShellSubtitle>
              Nothing is stored until it checks.
            </AppShellSubtitle>
          </AppShellHeading>
        </AppShellHeader>
        <AppShellBody>
          <Filler rows={10} />
        </AppShellBody>
        <AppShellFooter>
          <p className="text-xs text-muted-foreground">Not validated yet.</p>
          <div className="ml-auto flex gap-2">
            <Button variant="outline">Validate</Button>
            <Button>Create script</Button>
          </div>
        </AppShellFooter>
      </AppShellMain>
    </AppShell>
  ),
}

/** Collapsed rail — the trigger lives in the header, so it can always come back. */
export const NavCollapsed: Story = {
  render: () => (
    <AppShell defaultOpen={false}>
      <AppShellNav>
        <Nav />
      </AppShellNav>
      <AppShellMain>
        <AppShellHeader>
          <AppShellHeading>
            <AppShellTitle>Scripts</AppShellTitle>
          </AppShellHeading>
        </AppShellHeader>
        <AppShellBody>
          <Filler rows={4} />
        </AppShellBody>
      </AppShellMain>
    </AppShell>
  ),
}
