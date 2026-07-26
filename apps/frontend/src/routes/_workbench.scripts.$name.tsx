/**
 * One script, at its own URL — which is its run screen.
 *
 * Reads through `useScript` rather than picking the row out of the list, because a
 * deep link has no list yet — and the route accepts an id as well as a name, since
 * the API resolves both on this path. The key remounts the screen per script, so a
 * run never outlives the thing it ran.
 */
import { createFileRoute } from "@tanstack/react-router"
import {
  ScriptLoadingPane,
  ScriptMissingPane,
} from "@/components/scripts/script-panes"
import { ScriptScreen } from "@/components/scripts/script-screen"
import { useScript } from "@/hooks/api"

export const Route = createFileRoute("/_workbench/scripts/$name")({
  component: ScriptRoute,
})

function ScriptRoute() {
  const { name } = Route.useParams()
  const scriptQuery = useScript(name)

  if (scriptQuery.isPending) {
    return <ScriptLoadingPane name={name} />
  }

  if (!scriptQuery.data) {
    return (
      <ScriptMissingPane message={scriptQuery.error?.message} name={name} />
    )
  }

  return <ScriptScreen key={scriptQuery.data.id} script={scriptQuery.data} />
}
