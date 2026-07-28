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
 * When OIDC login is configured, the rail auth chip overwrites this with the
 * signed-in account id (`sub`). The default remains a real account so local
 * runs without auth still reach authorized tools instead of looking broken.
 */
export const userIdAtom = atom("anirudh@arcade.dev")

/** Which script the delete dialog is about to remove. */
export const deleteTargetAtom = atom<string | null>(null)

export const deleteDialogOpenAtom = atom(false)
