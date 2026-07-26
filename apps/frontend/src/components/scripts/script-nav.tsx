/**
 * The nav rail's contents: one row per stored script.
 *
 * There is no filter and no way to add one from here. Scripts are written by the
 * agent — the rail is for picking which of them you are looking at, and a list
 * short enough to read does not need a search box over it.
 *
 * Presentational: the caller owns the selection, which is what lets the layout
 * stories show the loading, empty and error rails without a client.
 */
import { BracesIcon, FileCode2Icon } from "lucide-react"
import type * as React from "react"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"
import type { ScriptView } from "./types"

function NavNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  )
}

function ScriptNav({
  scripts,
  selectedName,
  onSelect,
  loading = false,
  error = null,
  footer,
}: {
  scripts: ScriptView[]
  selectedName: string | null
  onSelect: (name: string) => void
  loading?: boolean
  error?: string | null
  footer?: React.ReactNode
}) {
  return (
    <>
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BracesIcon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-heading text-sm font-medium">
              Scripts
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {scripts.length === 1 ? "1 stored" : `${scripts.length} stored`}
            </span>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Stored</SidebarGroupLabel>
          <SidebarGroupContent>
            {loading ? (
              <SidebarMenu>
                {["one", "two", "three", "four"].map((key) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : error ? (
              <NavNote>{error}</NavNote>
            ) : scripts.length === 0 ? (
              <NavNote>Nothing stored yet.</NavNote>
            ) : (
              <SidebarMenu>
                {scripts.map((script) => (
                  <SidebarMenuItem key={script.id}>
                    <SidebarMenuButton
                      isActive={script.name === selectedName}
                      onClick={() => onSelect(script.name)}
                    >
                      <FileCode2Icon />
                      <span className="truncate font-mono">{script.name}</span>
                    </SidebarMenuButton>
                    {script.stale ? (
                      <SidebarMenuBadge className="text-destructive">
                        stale
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {footer ? <SidebarFooter className="p-3">{footer}</SidebarFooter> : null}
    </>
  )
}

export { ScriptNav }
