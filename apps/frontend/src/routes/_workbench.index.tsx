import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { BrowsePane } from "@/components/scripts/script-panes"
import { useScripts } from "@/hooks/api"
import { useScriptActions } from "@/hooks/script-actions"

export const Route = createFileRoute("/_workbench/")({ component: ScriptList })

function ScriptList() {
  const scriptsQuery = useScripts()
  const navigate = useNavigate()
  const { openDelete } = useScriptActions()

  return (
    <BrowsePane
      error={scriptsQuery.isError ? scriptsQuery.error.message : null}
      loading={scriptsQuery.isLoading}
      onDelete={openDelete}
      onOpen={(name) => navigate({ params: { name }, to: "/scripts/$name" })}
      scripts={scriptsQuery.data?.scripts ?? []}
      snapshotId={scriptsQuery.data?.snapshotId ?? null}
    />
  )
}
