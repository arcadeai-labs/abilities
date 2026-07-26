import { atom } from "jotai"

/**
 * The little state that outlives a route.
 *
 * Almost nothing does. What the user is looking at is the URL's job, and a run
 * belongs to the script whose page it happens on — so that lives in the pane and
 * resets when the pane changes script. What is left is the user we run as, which is
 * worth typing once, and the delete dialog's target, because the dialog is mounted
 * above the routes.
 */

/**
 * The Arcade end user tools execute as. Kept across scripts; it rarely changes.
 *
 * The default is a real account rather than a placeholder, because an unauthorized
 * user id makes every run come back `authorization_required` — which reads as the
 * app being broken rather than as a field wanting a value.
 */
export const userIdAtom = atom("anirudh@arcade.dev")

/** Which script the delete dialog is about to remove. */
export const deleteTargetAtom = atom<string | null>(null)

export const deleteDialogOpenAtom = atom(false)
