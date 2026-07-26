/**
 * The small read-only pieces of a script: whether the catalog has moved under it,
 * the toolkits it declared, the tools it may actually call, and the record-keeping
 * fields.
 *
 * `ScriptMetaBar` is the reason they live together. What matters on a script's page
 * is its code and its contract, so everything else is one quiet band rather than a
 * column of cards competing with them.
 */
import { TriangleAlertIcon } from "lucide-react"
import type * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ToolkitScopes } from "./toolkit-scopes"
import type { ScriptView } from "./types"

/**
 * Renders nothing for a current script. Nothing invalid is ever stored, so "fine"
 * is the only other state there is — and a badge on every healthy script is a
 * label, not information.
 */
function StaleBadge({ stale }: { stale: boolean }) {
  if (!stale) return null

  return (
    <Badge variant="destructive">
      <TriangleAlertIcon />
      Stale
    </Badge>
  )
}

function ToolkitBadges({
  toolkits,
  max = 4,
  className,
}: {
  toolkits: string[]
  max?: number
  className?: string
}) {
  if (toolkits.length === 0) {
    return <span className="text-muted-foreground">None</span>
  }

  const shown = toolkits.slice(0, max)
  const hidden = toolkits.length - shown.length

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((toolkit) => (
        <Badge className="font-mono" key={toolkit} variant="outline">
          {toolkit}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="ghost">+{hidden}</Badge> : null}
    </span>
  )
}

/** The grant at a glance; each badge carries the upstream tool as its title. */
function GrantBadges({
  grant,
  max = 4,
}: {
  grant: Record<string, string>
  max?: number
}) {
  const entries = Object.entries(grant)

  if (entries.length === 0) {
    return <span className="text-muted-foreground">Calls no tools</span>
  }

  const shown = entries.slice(0, max)
  const hidden = entries.length - shown.length

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(([alias, upstream]) => (
        <Badge
          className="font-mono"
          key={alias}
          title={upstream}
          variant="outline"
        >
          {alias}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="ghost">+{hidden}</Badge> : null}
    </span>
  )
}

/**
 * Slices the ISO string rather than formatting a `Date`: this page is rendered on
 * the server and hydrated in the browser, and a locale-dependent format is the
 * classic way to make those two disagree.
 */
function formatTimestamp(iso: string) {
  return iso.slice(0, 16).replace("T", " ")
}

function MetaItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-baseline truncate">{children}</span>
    </div>
  )
}

function ScriptMetaBar({
  script,
  className,
}: {
  script: ScriptView
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-2xl border bg-muted/30 px-4 py-2.5 text-xs",
        className
      )}
    >
      <MetaItem label="Version">v{script.version}</MetaItem>
      <MetaItem label="Updated">
        <span title={script.updatedAt}>
          {formatTimestamp(script.updatedAt)}
        </span>
      </MetaItem>
      <MetaItem label="Toolkits">
        <ToolkitScopes authorization={script.authorization} />
      </MetaItem>
      <MetaItem label="Grant">
        <GrantBadges grant={script.grant} />
      </MetaItem>
      <MetaItem label="Id">
        <span className="font-mono" title={`Snapshot ${script.snapshotId}`}>
          {script.id}
        </span>
      </MetaItem>
    </div>
  )
}

export {
  formatTimestamp,
  GrantBadges,
  ScriptMetaBar,
  StaleBadge,
  ToolkitBadges,
}
