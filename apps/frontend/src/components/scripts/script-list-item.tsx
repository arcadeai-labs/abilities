/**
 * One script as a row on the landing list: what it is, whether it still checks out,
 * and the two things you can do to it. Opening it lands on its run screen, which is
 * why the primary action says so. The nav rail renders a denser form of the same
 * information, so this one can afford the description and the badges.
 */
import { FileCode2Icon, PlayIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { StaleBadge, ToolkitBadges } from "./script-meta"
import type { ScriptView } from "./types"

function ScriptListItem({
  script,
  onOpen,
  onDelete,
}: {
  script: ScriptView
  onOpen: (name: string) => void
  onDelete: (name: string) => void
}) {
  const granted = Object.keys(script.grant).length

  return (
    <Item className="items-start" variant="outline">
      <ItemMedia className="mt-0.5" variant="icon">
        <FileCode2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex-wrap">
          <Button
            className="h-auto px-0 py-0 font-mono font-medium text-foreground"
            onClick={() => onOpen(script.name)}
            size="xs"
            variant="link"
          >
            {script.name}
          </Button>
          <StaleBadge stale={script.stale} />
        </ItemTitle>
        <ItemDescription>
          {script.description ?? "No description."}
        </ItemDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <ToolkitBadges toolkits={script.toolkits} />
          <span className="text-xs text-muted-foreground">
            {granted === 1 ? "1 tool granted" : `${granted} tools granted`} · v
            {script.version}
          </span>
        </div>
      </ItemContent>
      <ItemActions>
        <Button onClick={() => onOpen(script.name)} size="sm" variant="outline">
          <PlayIcon />
          Open
        </Button>
        <Button
          onClick={() => onDelete(script.name)}
          size="icon-sm"
          variant="destructive"
        >
          <Trash2Icon />
          <span className="sr-only">Delete {script.name}</span>
        </Button>
      </ItemActions>
    </Item>
  )
}

export { ScriptListItem }
