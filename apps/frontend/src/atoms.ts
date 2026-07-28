import { atom } from "jotai"

/**
 * The little state that outlives a route.
 *
 * Almost nothing does. What the user is looking at is the URL's job, and a run
 * belongs to the script whose page it happens on — so that lives in the pane and
 * resets when the pane changes script. What is left is the user we run as, which
 * the auth chip fills from the signed-in email, and the delete dialog's target,
 * because the dialog is mounted above the routes.
 */

/**
 * The Arcade end user tools execute as. Kept across scripts.
 *
 * The rail auth chip sets this from the signed-in email and clears it on sign
 * out. Empty means not signed in; a run then gets a 401 with an authorization URL.
 */
export const userIdAtom = atom("")

/** Which script the delete dialog is about to remove. */
export const deleteTargetAtom = atom<string | null>(null)

export const deleteDialogOpenAtom = atom(false)
