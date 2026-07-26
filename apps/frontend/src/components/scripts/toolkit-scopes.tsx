/**
 * The toolkits a script has in scope, each one hiding what it will actually ask the
 * end user to authorize.
 *
 * The point of hovering is the gap between the two: the toolkit is what the author
 * declared, the scopes come from the tools the grant names. Gmail's tools span nine
 * scope sets — a script that only lists mail asks for `gmail.readonly` and nothing
 * else, and that is only visible if you show the scopes next to the toolkit rather
 * than instead of it.
 *
 * Three states worth telling apart, which is why `requiresAuth` is not just
 * `scopes.length > 0`:
 *   - never called   — declared, unused, authorizes nothing
 *   - no account     — called, but the tools need no authorization at all
 *   - no scopes      — needs a connected account, declares no scopes per tool
 */
import { KeyRoundIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import type { ToolkitAuthorization } from "./types"

function ScopeSummary({ entry }: { entry: ToolkitAuthorization }) {
  if (entry.tools.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Declared but never called, so it authorizes nothing. Scopes follow the
        calls a script makes, not the toolkits it declares.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          {entry.tools.length === 1 ? "Tool called" : "Tools called"}
        </span>
        <ul className="flex flex-col gap-0.5 font-mono text-xs">
          {entry.tools.map((tool) => (
            <li key={tool}>{tool}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          Scopes
        </span>
        {entry.scopes.length > 0 ? (
          <ul className="flex flex-col gap-0.5 font-mono text-xs wrap-anywhere">
            {entry.scopes.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {entry.requiresAuth
              ? "None declared per tool — the provider still needs a connected account."
              : "None. These tools need no authorization."}
          </p>
        )}
      </div>
    </div>
  )
}

function ToolkitScopes({
  authorization,
  className,
}: {
  authorization: ToolkitAuthorization[]
  className?: string
}) {
  if (authorization.length === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No toolkits in scope
      </span>
    )
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {authorization.map((entry) => (
        <HoverCard key={entry.toolkit}>
          <HoverCardTrigger
            render={
              <Badge
                className="cursor-help font-mono"
                variant={entry.tools.length === 0 ? "ghost" : "outline"}
              />
            }
          >
            {entry.requiresAuth ? <KeyRoundIcon /> : null}
            {entry.toolkit}
          </HoverCardTrigger>
          <HoverCardContent className="w-80">
            <div className="flex flex-col gap-2">
              <h4 className="font-mono text-sm font-medium">{entry.toolkit}</h4>
              <ScopeSummary entry={entry} />
            </div>
          </HoverCardContent>
        </HoverCard>
      ))}
    </span>
  )
}

export { ToolkitScopes }
