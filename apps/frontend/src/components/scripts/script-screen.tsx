/**
 * A script's page: the run screen, with the contract and the method behind a sheet.
 *
 * The input, the error and the report are local state, and the route mounts this with
 * a key per script — so switching scripts cannot leave you looking at another one's
 * report next to this one's input. The input starts from the schema's declared
 * `default`s, with type-shaped placeholders for any required field that lacks
 * one — so Run always has a complete payload to edit. The user id is the
 * exception and lives in an atom: filled from the signed-in email when present.
 * An unauthenticated run is allowed to hit the API; a 401 returns an
 * authorization URL to open.
 */

import { useAtomValue } from "jotai"
import { useState } from "react"
import { userIdAtom } from "@/atoms"
import { AuthRecoveryError, useRunScript } from "@/hooks/api"
import { useScriptActions } from "@/hooks/script-actions"
import { defaultInputJson } from "./default-input"
import { ScriptDetailsSheet } from "./script-detail"
import { ScriptRunPane } from "./script-panes"
import type { RunReportView, ScriptView } from "./types"

export function ScriptScreen({ script }: { script: ScriptView }) {
  const userId = useAtomValue(userIdAtom)
  const [inputJson, setInputJson] = useState(() =>
    defaultInputJson(script.input)
  )
  const [error, setError] = useState<string | null>(null)
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
  const [report, setReport] = useState<RunReportView | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { openDelete } = useScriptActions()
  const run = useRunScript()

  const onRun = async () => {
    setError(null)
    setAuthorizationUrl(null)
    setReport(null)
    let input: unknown
    try {
      input = JSON.parse(inputJson)
    } catch {
      setError("Input must be valid JSON")
      return
    }
    try {
      setReport(
        await run.mutateAsync({
          name: script.name,
          // Body `userId` is ignored once a session exists; a placeholder keeps
          // the request valid so an unauthenticated run can still receive a 401
          // with an authorization URL.
          body: { input, userId: userId.trim() || "unauthenticated" },
        })
      )
    } catch (err) {
      if (err instanceof AuthRecoveryError) {
        setError(err.message)
        setAuthorizationUrl(err.authorizationUrl)
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <ScriptRunPane
        authorizationUrl={authorizationUrl}
        error={error}
        inputJson={inputJson}
        onDelete={openDelete}
        onInputJsonChange={setInputJson}
        onRun={() => void onRun()}
        onShowDetails={() => setDetailsOpen(true)}
        report={report}
        running={run.isPending}
        script={script}
        userId={userId}
      />
      <ScriptDetailsSheet
        onOpenChange={setDetailsOpen}
        open={detailsOpen}
        script={script}
      />
    </>
  )
}
