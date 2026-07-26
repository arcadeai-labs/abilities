/**
 * Maps Arcade's `Toolkit.ToolName` identifiers onto the `toolkit.methodName()`
 * surface scripts are written against, and back again.
 *
 * The reverse direction is the security-relevant one: a script's grant is derived
 * from the `toolkit.method` calls it makes, and the sandbox bridge has to turn
 * those back into exactly one upstream tool. So the mapping is built once per
 * catalog snapshot, collisions are resolved deterministically rather than
 * silently, and both directions come from the same table.
 */

/** Keys the run context occupies, which a toolkit therefore may not shadow. */
export const RESERVED_CTX_KEYS = new Set(["log"]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `GetIssue` → `getIssue`, `SendMessageToChannel` → `sendMessageToChannel`. */
function camel(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : "",
  );
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

export type ToolBinding = {
  /** `github.getIssue` — the path as written in a script. */
  path: string;
  /** `github` */
  namespace: string;
  /** `getIssue` */
  method: string;
  /** `Github.GetIssue` — the qualified name to send upstream. */
  qualifiedName: string;
  /** `Github.GetIssue@4.1.0` — the row's primary key. */
  fullyQualifiedName: string;
  toolkitName: string;
};

export type NameMap = {
  /** Namespace → its bindings, keyed by method name. */
  namespaces: Map<string, { toolkitName: string; methods: Map<string, ToolBinding> }>;
  /** `github.getIssue` → binding. The bridge's allowlist lookup. */
  byPath: Map<string, ToolBinding>;
  /** `Github.GetIssue` → binding. */
  byQualifiedName: Map<string, ToolBinding>;
  warnings: string[];
};

type NameInput = {
  name: string;
  qualifiedName: string;
  fullyQualifiedName: string;
  toolkitName: string;
};

/**
 * Claims `preferred` in `taken`, falling back to `fallback` and then to numeric
 * suffixes. Every fallback is reported: a renamed tool is a thing script authors
 * have to know about, so it must not be silent.
 */
function claim(
  taken: Map<string, unknown>,
  preferred: string,
  fallback: string,
  warnings: string[],
  describe: (chosen: string) => string,
): string {
  const candidates = [preferred, fallback];
  for (let n = 2; n < 100; n++) candidates.push(`${preferred}_${n}`);

  for (const candidate of candidates) {
    if (!IDENTIFIER.test(candidate) || taken.has(candidate)) continue;
    if (candidate !== preferred) warnings.push(describe(candidate));
    return candidate;
  }
  throw new Error(`could not find a free identifier for ${preferred}`);
}

/**
 * Builds the mapping for a catalog. Input is sorted internally so the same
 * catalog always produces the same identifiers — generated types and stored
 * grants would otherwise drift between snapshots for no reason.
 */
export function buildNameMap(tools: readonly NameInput[]): NameMap {
  const warnings: string[] = [];
  const namespaces: NameMap["namespaces"] = new Map();
  const byPath = new Map<string, ToolBinding>();
  const byQualifiedName = new Map<string, ToolBinding>();

  const sorted = [...tools].sort(
    (a, b) => a.toolkitName.localeCompare(b.toolkitName) || a.name.localeCompare(b.name),
  );

  // Namespaces first, so a collision resolves the same way regardless of which
  // tool in the toolkit happens to be visited first.
  const namespaceOf = new Map<string, string>();
  for (const tool of sorted) {
    if (namespaceOf.has(tool.toolkitName)) continue;
    const preferred = camel(tool.toolkitName);
    const reserved = RESERVED_CTX_KEYS.has(preferred);
    const namespace = claim(
      // Reserved keys are pre-taken so `claim` skips them.
      new Map([...namespaces].concat(reserved ? [[preferred, null as never]] : [])),
      preferred,
      camel(`${tool.toolkitName}Toolkit`),
      warnings,
      (chosen) =>
        reserved
          ? `toolkit \`${tool.toolkitName}\` maps onto the reserved context key \`${preferred}\`; exposed as \`${chosen}\``
          : `toolkit \`${tool.toolkitName}\` collides with another toolkit on \`${preferred}\`; exposed as \`${chosen}\``,
    );
    namespaceOf.set(tool.toolkitName, namespace);
    namespaces.set(namespace, { toolkitName: tool.toolkitName, methods: new Map() });
  }

  for (const tool of sorted) {
    const namespace = namespaceOf.get(tool.toolkitName)!;
    const entry = namespaces.get(namespace)!;

    // Defensive: sync stores latest versions only, so a repeated qualified name
    // would mean two versions landed. Keep the first and say so.
    if (byQualifiedName.has(tool.qualifiedName)) {
      warnings.push(`duplicate qualified name \`${tool.qualifiedName}\`; kept the first`);
      continue;
    }

    const method = claim(entry.methods, camel(tool.name), tool.name, warnings, (chosen) =>
      `tool \`${tool.qualifiedName}\` collides on \`${namespace}.${camel(tool.name)}\`; exposed as \`${namespace}.${chosen}\``,
    );

    const binding: ToolBinding = {
      path: `${namespace}.${method}`,
      namespace,
      method,
      qualifiedName: tool.qualifiedName,
      fullyQualifiedName: tool.fullyQualifiedName,
      toolkitName: tool.toolkitName,
    };
    entry.methods.set(method, binding);
    byPath.set(binding.path, binding);
    byQualifiedName.set(binding.qualifiedName, binding);
  }

  return { namespaces, byPath, byQualifiedName, warnings };
}
