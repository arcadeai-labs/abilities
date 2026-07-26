import { Link } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  deleteDialogOpenAtom,
  draftErrorAtom,
  editingNameAtom,
  editorModeAtom,
  emptyScriptDraft,
  runDialogOpenAtom,
  runErrorAtom,
  runInputJsonAtom,
  runReportAtom,
  type ScriptDraft,
  scriptDraftAtom,
  selectedScriptNameAtom,
  userIdAtom,
  validationMessageAtom,
} from "@/atoms"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  parseJsonObject,
  parseToolkits,
  type Script,
  type UpsertScriptBody,
  useDeleteScript,
  useRunScript,
  useScripts,
  useUpsertScript,
  useValidateScript,
} from "@/hooks/api"

function draftToBody(draft: ScriptDraft): UpsertScriptBody {
  return {
    description: draft.description || undefined,
    input: parseJsonObject(draft.inputJson),
    output: parseJsonObject(draft.outputJson),
    toolkits: parseToolkits(draft.toolkitsText),
    run: draft.run,
  }
}

function scriptToDraft(script: Script): ScriptDraft {
  return {
    name: script.name,
    description: script.description ?? "",
    toolkitsText: script.toolkits.join(", "),
    inputJson: JSON.stringify(script.input, null, 2),
    outputJson: JSON.stringify(script.output, null, 2),
    run: script.run,
  }
}

function formatValidation(diagnostics: { code: string; message: string }[]) {
  return diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n")
}

export function ScriptsApp() {
  const editorMode = useAtomValue(editorModeAtom)

  if (editorMode === "closed") {
    return (
      <>
        <ScriptsList />
        <RunDialog />
        <DeleteDialog />
      </>
    )
  }

  return <ScriptEditor />
}

function ScriptsList() {
  const scriptsQuery = useScripts()
  const setEditorMode = useSetAtom(editorModeAtom)
  const setEditingName = useSetAtom(editingNameAtom)
  const setDraft = useSetAtom(scriptDraftAtom)
  const setDraftError = useSetAtom(draftErrorAtom)
  const setValidationMessage = useSetAtom(validationMessageAtom)
  const setSelected = useSetAtom(selectedScriptNameAtom)
  const setRunOpen = useSetAtom(runDialogOpenAtom)
  const setRunError = useSetAtom(runErrorAtom)
  const setRunReport = useSetAtom(runReportAtom)
  const setDeleteOpen = useSetAtom(deleteDialogOpenAtom)

  const openCreate = () => {
    setDraft(emptyScriptDraft)
    setEditingName(null)
    setDraftError(null)
    setValidationMessage(null)
    setEditorMode("create")
  }

  const openEdit = (script: Script) => {
    setDraft(scriptToDraft(script))
    setEditingName(script.name)
    setDraftError(null)
    setValidationMessage(null)
    setEditorMode("edit")
  }

  const openRun = (name: string) => {
    setSelected(name)
    setRunError(null)
    setRunReport(null)
    setRunOpen(true)
  }

  const openDelete = (name: string) => {
    setSelected(name)
    setDeleteOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scripts</CardTitle>
        <CardDescription>
          Create, validate, run, and delete typed scripts against the catalog.
        </CardDescription>
        <CardAction>
          <ButtonGroup>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/chat" />}
            >
              Chat
            </Button>
            <Button onClick={openCreate}>New script</Button>
          </ButtonGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {scriptsQuery.isLoading ? (
          <Spinner />
        ) : scriptsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load scripts</AlertTitle>
            <AlertDescription>{scriptsQuery.error.message}</AlertDescription>
          </Alert>
        ) : !scriptsQuery.data?.scripts.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No scripts yet</EmptyTitle>
              <EmptyDescription>
                Create a script to validate and run code against the tool
                catalog.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}>New script</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scriptsQuery.data.scripts.map((script) => (
                <TableRow key={script.id}>
                  <TableCell>{script.name}</TableCell>
                  <TableCell>{script.description ?? "—"}</TableCell>
                  <TableCell>{script.version}</TableCell>
                  <TableCell>
                    {script.stale ? (
                      <Badge variant="destructive">Stale</Badge>
                    ) : (
                      <Badge variant="secondary">Current</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ButtonGroup>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(script)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openRun(script.name)}
                      >
                        Run
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openDelete(script.name)}
                      >
                        Delete
                      </Button>
                    </ButtonGroup>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ScriptEditor() {
  const [draft, setDraft] = useAtom(scriptDraftAtom)
  const editorMode = useAtomValue(editorModeAtom)
  const editingName = useAtomValue(editingNameAtom)
  const setEditorMode = useSetAtom(editorModeAtom)
  const [draftError, setDraftError] = useAtom(draftErrorAtom)
  const [validationMessage, setValidationMessage] = useAtom(
    validationMessageAtom
  )

  const upsert = useUpsertScript()
  const validate = useValidateScript()

  const update = <K extends keyof ScriptDraft>(key: K, value: ScriptDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const close = () => {
    setEditorMode("closed")
    setDraftError(null)
    setValidationMessage(null)
  }

  const buildBody = (): UpsertScriptBody | null => {
    try {
      setDraftError(null)
      return draftToBody(draft)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  const onValidate = async () => {
    const body = buildBody()
    if (!body) return
    setValidationMessage(null)
    try {
      const result = await validate.mutateAsync(body)
      if (result.ok) {
        setValidationMessage(
          `Valid. Grant: ${JSON.stringify(result.grant) || "{}"}`
        )
      } else {
        setValidationMessage(formatValidation(result.diagnostics))
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err))
    }
  }

  const onSave = async () => {
    const body = buildBody()
    if (!body) return
    const name = editingName ?? draft.name.trim()
    if (!name) {
      setDraftError("Name is required")
      return
    }
    setValidationMessage(null)
    try {
      const result = await upsert.mutateAsync({ name, body })
      if (result.kind === "bad_name") {
        setDraftError(result.message)
        return
      }
      if (result.kind === "invalid") {
        setValidationMessage(formatValidation(result.validation.diagnostics))
        return
      }
      close()
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = upsert.isPending || validate.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editorMode === "create" ? "New script" : `Edit ${editingName}`}
        </CardTitle>
        <CardDescription>
          Submit a contract as JSON Schema plus an async run method. Invalid
          scripts are never stored.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={close} disabled={busy}>
            Back
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="script-name">Name</FieldLabel>
            <Input
              id="script-name"
              value={draft.name}
              disabled={editorMode === "edit" || busy}
              onChange={(e) => update("name", e.target.value)}
              placeholder="my-script"
            />
            <FieldDescription>
              Lowercase letters, digits, and dashes.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="script-description">Description</FieldLabel>
            <Input
              id="script-description"
              value={draft.description}
              disabled={busy}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="script-toolkits">Toolkits</FieldLabel>
            <Input
              id="script-toolkits"
              value={draft.toolkitsText}
              disabled={busy}
              onChange={(e) => update("toolkitsText", e.target.value)}
              placeholder="math, gmail"
            />
            <FieldDescription>
              Comma-separated namespaces put in scope for run.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="script-input">Input schema</FieldLabel>
            <Textarea
              id="script-input"
              value={draft.inputJson}
              disabled={busy}
              rows={8}
              onChange={(e) => update("inputJson", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="script-output">Output schema</FieldLabel>
            <Textarea
              id="script-output"
              value={draft.outputJson}
              disabled={busy}
              rows={8}
              onChange={(e) => update("outputJson", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="script-run">Run</FieldLabel>
            <Textarea
              id="script-run"
              value={draft.run}
              disabled={busy}
              rows={12}
              onChange={(e) => update("run", e.target.value)}
            />
            <FieldDescription>
              Method source starting with async run(input, {"{ ... }"}).
            </FieldDescription>
          </Field>
          {draftError ? <FieldError>{draftError}</FieldError> : null}
          {validationMessage ? (
            <Alert>
              <AlertTitle>Validation</AlertTitle>
              <AlertDescription>{validationMessage}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <ButtonGroup>
          <Button variant="outline" onClick={onValidate} disabled={busy}>
            {validate.isPending ? <Spinner /> : "Validate"}
          </Button>
          <Button onClick={onSave} disabled={busy}>
            {upsert.isPending ? <Spinner /> : "Save"}
          </Button>
        </ButtonGroup>
      </CardFooter>
    </Card>
  )
}

function RunDialog() {
  const [open, setOpen] = useAtom(runDialogOpenAtom)
  const selected = useAtomValue(selectedScriptNameAtom)
  const [inputJson, setInputJson] = useAtom(runInputJsonAtom)
  const [userId, setUserId] = useAtom(userIdAtom)
  const [runError, setRunError] = useAtom(runErrorAtom)
  const [report, setReport] = useAtom(runReportAtom)
  const run = useRunScript()

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      run.reset()
      setRunError(null)
      setReport(null)
    }
  }

  const onRun = async () => {
    if (!selected) return
    setRunError(null)
    setReport(null)
    let input: unknown
    try {
      input = JSON.parse(inputJson)
    } catch {
      setRunError("Input must be valid JSON")
      return
    }
    if (!userId.trim()) {
      setRunError("userId is required")
      return
    }
    try {
      const next = await run.mutateAsync({
        name: selected,
        body: { input, userId: userId.trim() },
      })
      setReport(next)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run {selected}</DialogTitle>
          <DialogDescription>
            Executes in the sandbox as the given Arcade user.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="run-user">User ID</FieldLabel>
            <Input
              id="run-user"
              value={userId}
              disabled={run.isPending}
              onChange={(e) => setUserId(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="run-input">Input JSON</FieldLabel>
            <Textarea
              id="run-input"
              value={inputJson}
              disabled={run.isPending}
              rows={6}
              onChange={(e) => setInputJson(e.target.value)}
            />
          </Field>
          {runError ? <FieldError>{runError}</FieldError> : null}
          {report ? (
            <Alert>
              <AlertTitle>
                {typeof report === "object" &&
                report !== null &&
                "outcome" in report &&
                typeof report.outcome === "object" &&
                report.outcome !== null &&
                "kind" in report.outcome
                  ? String(report.outcome.kind)
                  : "Report"}
              </AlertTitle>
              <AlertDescription>
                <pre>{JSON.stringify(report, null, 2)}</pre>
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onRun} disabled={run.isPending || !selected}>
            {run.isPending ? <Spinner /> : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog() {
  const [open, setOpen] = useAtom(deleteDialogOpenAtom)
  const selected = useAtomValue(selectedScriptNameAtom)
  const setSelected = useSetAtom(selectedScriptNameAtom)
  const remove = useDeleteScript()

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) remove.reset()
  }

  const onConfirm = async () => {
    if (!selected) return
    await remove.mutateAsync(selected)
    setSelected(null)
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete script?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {selected}. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending || !selected}
            onClick={(e) => {
              e.preventDefault()
              void onConfirm()
            }}
          >
            {remove.isPending ? <Spinner /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
