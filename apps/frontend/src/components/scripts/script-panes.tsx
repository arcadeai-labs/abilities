/**
 * What the main pane can be: the list of everything, one script's run screen, or
 * the two states a deep link into a script can land in.
 *
 * A script's page *is* its run screen. The contract and the method are one click
 * away in a sheet, but running the thing is why you opened it — and the report is
 * the only way to learn something a stored row cannot already tell you.
 *
 * Each owns its header, because the header is part of the pane rather than of the
 * shell. All of them are presentational, which is what lets the workbench story show
 * every state of the screen without a client.
 *
 * None of them writes. Authoring a script means validating it against the catalog
 * and storing only if it checks, and that loop belongs to the agent — it has the
 * same routes as tools, so it writes, validates and stores in one turn.
 */
import {
  FileCode2Icon,
  PlayIcon,
  ScrollTextIcon,
  SearchXIcon,
  Trash2Icon,
} from "lucide-react"
import {
  AppShellActions,
  AppShellBody,
  AppShellFooter,
  AppShellHeader,
  AppShellHeading,
  AppShellSubtitle,
  AppShellTitle,
} from "@/components/layouts/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { RunPanel } from "./run-panel"
import { ScriptListItem } from "./script-list-item"
import { StaleBadge } from "./script-meta"
import { ToolkitScopes } from "./toolkit-scopes"
import type { RunReportView, ScriptView } from "./types"

function BrowsePane({
  scripts,
  snapshotId = null,
  loading = false,
  error = null,
  onOpen,
  onDelete,
}: {
  scripts: ScriptView[]
  snapshotId?: string | null
  loading?: boolean
  error?: string | null
  onOpen: (name: string) => void
  onDelete: (name: string) => void
}) {
  const stale = scripts.filter((script) => script.stale).length

  return (
    <>
      <AppShellHeader>
        <AppShellHeading>
          <AppShellTitle>Scripts</AppShellTitle>
          <AppShellSubtitle>
            {snapshotId
              ? `Catalog snapshot ${snapshotId}${stale > 0 ? ` · ${stale} stale` : ""}`
              : "TypeScript against the tool catalog, checked before it is stored."}
          </AppShellSubtitle>
        </AppShellHeading>
      </AppShellHeader>

      <AppShellBody>
        {loading ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {["one", "two", "three", "four"].map((key) => (
              <Skeleton className="h-28 rounded-2xl" key={key} />
            ))}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load scripts</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : scripts.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileCode2Icon />
              </EmptyMedia>
              <EmptyTitle>No scripts yet</EmptyTitle>
              <EmptyDescription>
                Ask the agent for one. It has the whole API as tools, so it can
                write the contract and the method, validate them against the
                catalog and store the result — which is the only way a script
                gets written.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {scripts.map((script) => (
              <ScriptListItem
                key={script.id}
                onDelete={onDelete}
                onOpen={onOpen}
                script={script}
              />
            ))}
          </div>
        )}
      </AppShellBody>
    </>
  )
}

function ScriptRunPane({
  script,
  userId,
  onUserIdChange,
  inputJson,
  onInputJsonChange,
  running = false,
  error = null,
  report = null,
  onRun,
  onShowDetails,
  onDelete,
}: {
  script: ScriptView
  userId: string
  onUserIdChange: (userId: string) => void
  inputJson: string
  onInputJsonChange: (inputJson: string) => void
  running?: boolean
  error?: string | null
  report?: RunReportView | null
  onRun: () => void
  onShowDetails: () => void
  onDelete: (name: string) => void
}) {
  return (
    <>
      <AppShellHeader>
        <AppShellHeading>
          <AppShellTitle>
            <span className="truncate font-mono">{script.name}</span>
            <StaleBadge stale={script.stale} />
          </AppShellTitle>
          <AppShellSubtitle>
            {script.description ?? "No description."}
          </AppShellSubtitle>
        </AppShellHeading>
        <AppShellActions>
          <Button onClick={onShowDetails} variant="outline">
            <ScrollTextIcon />
            Contract and code
          </Button>
          <Button onClick={() => onDelete(script.name)} variant="destructive">
            <Trash2Icon />
            <span className="sr-only">Delete {script.name}</span>
          </Button>
        </AppShellActions>
      </AppShellHeader>

      <AppShellBody>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {/* What this run will ask for, before you ask for it. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="tracking-wide text-muted-foreground uppercase">
              Toolkits
            </span>
            <ToolkitScopes authorization={script.authorization} />
            <span className="text-muted-foreground">
              Hover for the scopes it will ask this user to grant.
            </span>
          </div>
          <RunPanel
            disabled={running}
            error={error}
            inputJson={inputJson}
            onInputJsonChange={onInputJsonChange}
            onUserIdChange={onUserIdChange}
            report={report}
            userId={userId}
          />
        </div>
      </AppShellBody>

      <AppShellFooter>
        <p className="text-xs text-muted-foreground">
          Runs in the sandbox with only the tools this script's grant names.
          There is no dry-run: point it at read-only tools.
        </p>
        <Button className="ml-auto" disabled={running} onClick={onRun}>
          {running ? <Spinner /> : <PlayIcon />}
          {report ? "Run again" : "Run"}
        </Button>
      </AppShellFooter>
    </>
  )
}

/**
 * `/scripts/:name` is a real URL, so it can be opened cold or point at something
 * that has since been deleted. These are those two moments.
 */
function ScriptLoadingPane({ name }: { name: string }) {
  return (
    <>
      <AppShellHeader>
        <AppShellHeading>
          <AppShellTitle>
            <span className="truncate font-mono">{name}</span>
          </AppShellTitle>
          <AppShellSubtitle>Loading…</AppShellSubtitle>
        </AppShellHeading>
      </AppShellHeader>
      <AppShellBody>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </AppShellBody>
    </>
  )
}

function ScriptMissingPane({
  name,
  message,
}: {
  name: string
  message?: string | null
}) {
  return (
    <>
      <AppShellHeader>
        <AppShellHeading>
          <AppShellTitle>
            <span className="truncate font-mono">{name}</span>
          </AppShellTitle>
          <AppShellSubtitle>Not found</AppShellSubtitle>
        </AppShellHeading>
      </AppShellHeader>
      <AppShellBody>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No script called {name}</EmptyTitle>
            <EmptyDescription>
              {message ??
                "It may have been deleted, or the name in the URL may be wrong. The rail lists everything that is stored."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </AppShellBody>
    </>
  )
}

export { BrowsePane, ScriptLoadingPane, ScriptMissingPane, ScriptRunPane }
