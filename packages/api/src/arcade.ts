/**
 * The only thing on the far side of the sandbox bridge.
 *
 * Every call is made as a named end user, never as the deployment: the API key
 * lives here and is never visible to a script, and a tool runs against whatever
 * that user has authorized. So even a total escape at the JavaScript level is
 * bounded by what the invoking user could already do through Arcade directly.
 */

import Arcade from "@arcadeai/arcadejs";

let client: Arcade | undefined;

/** Lazy so importing this module doesn't require a key to be present. */
function arcade(): Arcade {
  if (!process.env.ARCADE_API_KEY) {
    throw new Error("ARCADE_API_KEY is not set; tool execution is unavailable.");
  }
  return (client ??= new Arcade());
}

export class ToolExecutionError extends Error {}

/** Runs one tool and returns its value, or throws with a message safe to show. */
export async function executeTool(
  qualifiedName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  const response = await arcade().tools.execute({
    tool_name: qualifiedName,
    input,
    user_id: userId,
  });

  const output = response.output;

  if (response.success === false || output?.error) {
    throw new ToolExecutionError(output?.error?.message ?? `\`${qualifiedName}\` failed.`);
  }

  return output?.value ?? null;
}

export type AuthorizationStatus = {
  qualifiedName: string;
  status: "authorized" | "pending";
  /** Where to send the user when `status` is `pending`. */
  authUrl?: string;
};

/**
 * Checks every tool in a grant that declares an authorization requirement.
 *
 * This is the difference between "your run failed" and "click here to connect
 * GitHub", so it runs before the sandbox starts rather than surfacing as a tool
 * error partway through — by which point earlier tools have already had effects.
 */
export async function checkAuthorization(
  qualifiedNames: readonly string[],
  userId: string,
): Promise<{ ready: boolean; tools: AuthorizationStatus[] }> {
  const tools = await Promise.all(
    qualifiedNames.map(async (qualifiedName): Promise<AuthorizationStatus> => {
      const response = await arcade().tools.authorize({ tool_name: qualifiedName, user_id: userId });
      return response.status === "completed"
        ? { qualifiedName, status: "authorized" }
        : { qualifiedName, status: "pending", authUrl: response.url };
    }),
  );

  return { ready: tools.every((tool) => tool.status === "authorized"), tools };
}
