/**
 * A conversation for the stories. `useChat` owns its messages and there is no way
 * to hand it any, so the transcript is exercised through fixtures instead — which
 * is also the only way to see a tool call without standing up the agent.
 */
import type { UIMessage } from "ai"

const sampleConversation: UIMessage[] = [
  {
    id: "msg_1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Write me a script that reads a GitHub issue and returns its title and comment count.",
      },
    ],
  },
  {
    id: "msg_2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Checking it against the catalog before storing it.",
      },
      {
        type: "tool-validate_script",
        toolCallId: "call_1",
        state: "output-available",
        input: {
          toolkits: ["github"],
          run: "async run(input, { github }) { … }",
        },
        output: {
          ok: true,
          grant: { "github.getIssue": "Github.GetIssue" },
          diagnostics: [],
        },
      },
      {
        type: "tool-upsert_script",
        toolCallId: "call_2",
        state: "output-available",
        input: { name: "summarize-issue" },
        output: { id: "scr_01hq9k3m7x", version: 1 },
      },
      {
        type: "text",
        text: "Stored as `summarize-issue`. It is granted `Github.GetIssue` and nothing else, because that is the only tool it calls.",
      },
    ],
  },
]

export { sampleConversation }
