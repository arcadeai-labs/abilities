/**
 * Story data for the scripts UI.
 *
 * Hand-written rather than captured, but shaped like real rows: schemas the
 * codegen would accept, a grant that matches the calls in `run`, and one script
 * left on an older snapshot so the stale path has something to show. Only the
 * stories import this, so it never reaches the app bundle.
 */
import type { RunReportView, ScriptView } from "./types"

const summarizeIssue: ScriptView = {
  id: "scr_01hq9k3m7x",
  name: "summarize-issue",
  description: "Reads a GitHub issue and returns its title and comment count.",
  run: `async run(input, { github, log }) {
  const issue = await github.getIssue({
    owner: input.owner,
    repo: input.repo,
    issueNumber: input.number,
  });
  log("fetched issue", input.number);
  return {
    title: issue.title ?? "(untitled)",
    comments: issue.comments ?? 0,
  };
}`,
  input: {
    type: "object",
    properties: {
      owner: { type: "string", default: "arcadeai" },
      repo: { type: "string", default: "arcade-ai" },
      number: { type: "integer", default: 481 },
    },
    required: ["owner", "repo", "number"],
  },
  output: {
    type: "object",
    properties: {
      title: { type: "string" },
      comments: { type: "integer" },
    },
    required: ["title", "comments"],
  },
  version: 4,
  grant: { "github.getIssue": "Github.GetIssue" },
  toolkits: ["github"],
  authorization: [
    {
      toolkit: "github",
      tools: ["github.getIssue"],
      // Github demands an account but declares no scopes per tool.
      scopes: [],
      requiresAuth: true,
    },
  ],
  snapshotId: "snap_2026_07_24",
  stale: false,
  createdAt: "2026-07-02T09:14:05.000Z",
  updatedAt: "2026-07-24T16:41:22.000Z",
}

const triageInbox: ScriptView = {
  id: "scr_01hq9m8p2c",
  name: "triage-inbox",
  description:
    "Lists unread mail and files anything from a known vendor under Vendors.",
  run: `async run(input, { gmail, log }) {
  const found = await gmail.listEmails({ maxResults: input.limit ?? 25 });
  const shape = z.object({ messages: z.array(z.object({ id: z.string() })) });
  const { messages } = shape.parse(found);
  log("unread", messages.length);
  for (const message of messages) {
    await gmail.labelMessage({ messageId: message.id, label: "Vendors" });
  }
  return { filed: messages.length };
}`,
  input: {
    type: "object",
    properties: { limit: { type: "integer", maximum: 100, default: 25 } },
  },
  output: {
    type: "object",
    properties: { filed: { type: "integer" } },
    required: ["filed"],
  },
  version: 2,
  grant: {
    "gmail.listEmails": "Gmail.ListEmails",
    "gmail.labelMessage": "Gmail.LabelMessage",
  },
  toolkits: ["gmail"],
  authorization: [
    {
      toolkit: "gmail",
      tools: ["gmail.labelMessage", "gmail.listEmails"],
      scopes: [
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
      requiresAuth: true,
    },
  ],
  snapshotId: "snap_2026_06_11",
  stale: true,
  createdAt: "2026-06-11T11:02:41.000Z",
  updatedAt: "2026-06-18T08:23:19.000Z",
}

const addNumbers: ScriptView = {
  id: "scr_01hq9nb4tt",
  name: "add-numbers",
  description: null,
  run: `async run(input, { math }) {
  const sum = await math.add({ a: input.a, b: input.b });
  return { sum };
}`,
  input: {
    type: "object",
    properties: {
      a: { type: "string", default: "2" },
      b: { type: "string", default: "3" },
    },
    required: ["a", "b"],
  },
  output: {
    type: "object",
    properties: { sum: { type: "string" } },
    required: ["sum"],
  },
  version: 1,
  grant: { "math.add": "Math.Add" },
  toolkits: ["math"],
  authorization: [
    { toolkit: "math", tools: ["math.add"], scopes: [], requiresAuth: false },
  ],
  snapshotId: "snap_2026_07_24",
  stale: false,
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
}

const digestReleases: ScriptView = {
  id: "scr_01hq9pf6wq",
  name: "digest-releases",
  description: "Collects this week's releases across a list of repositories.",
  run: `async run(input, { github, log }) {
  const digest = [];
  for (const repo of input.repos) {
    const releases = await github.listReleases({ owner: input.owner, repo });
    log("releases for", repo);
    digest.push({ repo, count: Array.isArray(releases) ? releases.length : 0 });
  }
  return { digest };
}`,
  input: {
    type: "object",
    properties: {
      owner: { type: "string", default: "arcadeai" },
      repos: {
        type: "array",
        items: { type: "string" },
        default: ["arcade-ai", "arcadejs"],
      },
    },
    required: ["owner", "repos"],
  },
  output: {
    type: "object",
    properties: {
      digest: {
        type: "array",
        items: {
          type: "object",
          properties: { repo: { type: "string" }, count: { type: "integer" } },
        },
      },
    },
    required: ["digest"],
  },
  version: 7,
  grant: { "github.listReleases": "Github.ListReleases" },
  toolkits: ["github", "slack"],
  authorization: [
    {
      toolkit: "github",
      tools: ["github.listReleases"],
      scopes: [],
      requiresAuth: true,
    },
    // Declared and never called: it authorizes nothing.
    { toolkit: "slack", tools: [], scopes: [], requiresAuth: false },
  ],
  snapshotId: "snap_2026_07_24",
  stale: false,
  createdAt: "2026-05-19T13:31:00.000Z",
  updatedAt: "2026-07-21T19:05:44.000Z",
}

const sampleScripts: ScriptView[] = [
  addNumbers,
  digestReleases,
  summarizeIssue,
  triageInbox,
]

const successfulRun: RunReportView = {
  runId: "run_01hq9rc8k4",
  outcome: {
    kind: "ok",
    output: { title: "Streaming breaks on reconnect", comments: 12 },
  },
  logs: ["fetched issue 481"],
  toolCalls: [
    {
      path: "github.getIssue",
      qualifiedName: "Github.GetIssue",
      ok: true,
      durationMs: 412,
    },
  ],
  drift: [
    {
      tool: "Github.GetIssue",
      violations: [
        {
          path: "reactions",
          message:
            "Present in the response but absent from the declared shape.",
        },
      ],
    },
  ],
  durationMs: 604,
}

const authorizationRequiredRun: RunReportView = {
  runId: "run_01hq9rd1m9",
  outcome: {
    kind: "authorization_required",
    tools: [
      {
        qualifiedName: "Gmail.ListEmails",
        authUrl:
          "https://accounts.google.com/o/oauth2/auth?scope=gmail.readonly",
      },
      { qualifiedName: "Gmail.LabelMessage" },
    ],
  },
  logs: [],
  toolCalls: [],
  drift: [],
  durationMs: 88,
}

const failedRun: RunReportView = {
  runId: "run_01hq9rf3p1",
  outcome: {
    kind: "tool_error",
    tool: "Math.Divide",
    message: "division by zero",
  },
  logs: ["dividing 8 by 0"],
  toolCalls: [
    {
      path: "math.divide",
      qualifiedName: "Math.Divide",
      ok: false,
      durationMs: 233,
      error: "division by zero",
    },
  ],
  drift: [],
  durationMs: 311,
}

export {
  addNumbers,
  authorizationRequiredRun,
  digestReleases,
  failedRun,
  sampleScripts,
  successfulRun,
  summarizeIssue,
  triageInbox,
}
