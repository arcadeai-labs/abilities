/**
 * The frame a page hangs off: a nav rail, a header that stays put, and one
 * scrolling body.
 *
 * The height is pinned to the viewport and `AppShellBody` owns the only scroll
 * container, so a long page scrolls under the header rather than pushing it away,
 * and the rail scrolls independently of it. `AppShellHeader` carries the sidebar
 * trigger itself, so no page has to remember to place one.
 *
 * There is one rail, deliberately. What it holds is the caller's business — the
 * workbench swaps the script list for the agent in the same place — and a second
 * one would fight the first: sidebars share an open state and the ⌘B shortcut
 * through `SidebarProvider`, so it would toggle with the nav and steal the
 * header's trigger.
 */
import type * as React from "react"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

function AppShell({
  className,
  ...props
}: React.ComponentProps<typeof SidebarProvider>) {
  return (
    <SidebarProvider
      className={cn("h-svh min-h-svh overflow-hidden", className)}
      {...props}
    />
  )
}

/**
 * The nav rail. `inset` is the default because it reads as a surface the page
 * floats on, which is the whole reason to have a rail rather than a header menu.
 */
function AppShellNav({
  variant = "inset",
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return <Sidebar variant={variant} {...props} />
}

function AppShellMain({
  className,
  ...props
}: React.ComponentProps<typeof SidebarInset>) {
  return (
    <SidebarInset
      className={cn("min-w-0 overflow-hidden", className)}
      {...props}
    />
  )
}

function AppShellHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b px-4",
        className
      )}
      {...props}
    >
      <SidebarTrigger className="-ml-1" />
      <Separator className="h-5" orientation="vertical" />
      {children}
    </header>
  )
}

function AppShellHeading({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />
  )
}

function AppShellTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "flex items-center gap-2 truncate font-heading text-sm leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function AppShellSubtitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "truncate text-xs leading-none text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function AppShellActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("ml-auto flex shrink-0 items-center gap-2", className)}
      {...props}
    />
  )
}

function AppShellBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto p-6", className)}
      {...props}
    />
  )
}

/** Pinned under the body, outside its scroll — where a form's commit actions go. */
function AppShellFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-t bg-background/80 px-6 py-3 backdrop-blur",
        className
      )}
      {...props}
    />
  )
}

export {
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
}
