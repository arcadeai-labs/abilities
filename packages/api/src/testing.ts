/**
 * Shared setup for the test suites.
 *
 * The suites call the real Arcade API rather than substituting a fake tool
 * executor. `Math` is what makes that practical: 23 tools that need neither
 * authorization nor secrets, are marked `read_only`, and return deterministic
 * answers — so a test can assert `2 + 3 === "5"` against production infrastructure
 * without an OAuth dance or a cleanup step.
 *
 * The cost is that the suite needs `ARCADE_API_KEY` and a synced catalog. That is
 * the intended trade: a passing run means the path callers actually take works,
 * not that a stand-in behaved as its author imagined.
 */

import { executeTool } from "./arcade";

/** Any identifier works for `Math`; nothing about it is user-scoped. */
export const TEST_USER = process.env.ARCADE_USER_ID ?? "vitest@arcade.dev";

/**
 * A user who has authorized nothing, for exercising the authorization pre-flight.
 * Deliberately not derived from a real account.
 */
export const UNAUTHORIZED_USER = "vitest-unauthorized@example.invalid";

/**
 * The same bridge `runScript` installs: the sandbox takes its tool executor as a
 * parameter in production too, so passing the real one here is the production
 * wiring rather than a substitute for it.
 */
export const realBridge = (qualifiedName: string, _path: string, args: unknown) =>
  executeTool(qualifiedName, args as Record<string, unknown>, TEST_USER);

export function requireArcadeKey(): void {
  if (!process.env.ARCADE_API_KEY) {
    throw new Error(
      "These tests call the real Arcade API. Set ARCADE_API_KEY in the workspace-root .env " +
        "and run `pnpm --filter @repo/api sync` first.",
    );
  }
}
