/**
 * Opening the delete dialog, from whichever route asked.
 *
 * The dialog is mounted once, in the workbench layout, so its target is state rather
 * than a route param — both the list and a script's own page can point it at
 * something.
 */
import { useSetAtom } from "jotai"
import { deleteDialogOpenAtom, deleteTargetAtom } from "@/atoms"

export function useScriptActions() {
  const setTarget = useSetAtom(deleteTargetAtom)
  const setOpen = useSetAtom(deleteDialogOpenAtom)

  const openDelete = (name: string) => {
    setTarget(name)
    setOpen(true)
  }

  return { openDelete }
}
