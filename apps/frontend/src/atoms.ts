import { atom } from "jotai"

export type ScriptDraft = {
  name: string
  description: string
  toolkitsText: string
  inputJson: string
  outputJson: string
  run: string
}

export type EditorMode = "closed" | "create" | "edit"

export const emptyScriptDraft: ScriptDraft = {
  name: "",
  description: "",
  toolkitsText: "math",
  inputJson: `{
  "type": "object",
  "properties": {
    "a": { "type": "string" },
    "b": { "type": "string" }
  },
  "required": ["a", "b"]
}`,
  outputJson: `{
  "type": "object",
  "properties": {
    "sum": { "type": "string" }
  },
  "required": ["sum"]
}`,
  run: `async run(input, { math, log }) {
  const sum = await math.add({ a: input.a, b: input.b });
  log("sum is", sum);
  return { sum };
}`,
}

/** Which script name is selected in the list (for run/delete). */
export const selectedScriptNameAtom = atom<string | null>(null)

/** Create / edit sheet state. */
export const editorModeAtom = atom<EditorMode>("closed")

/** Name used on the PUT path when editing; null while creating. */
export const editingNameAtom = atom<string | null>(null)

export const scriptDraftAtom = atom<ScriptDraft>(emptyScriptDraft)

export const draftErrorAtom = atom<string | null>(null)

export const validationMessageAtom = atom<string | null>(null)

export const runDialogOpenAtom = atom(false)

export const runInputJsonAtom = atom("{}")

export const userIdAtom = atom("user")

export const runErrorAtom = atom<string | null>(null)

export const runReportAtom = atom<unknown | null>(null)

export const deleteDialogOpenAtom = atom(false)
