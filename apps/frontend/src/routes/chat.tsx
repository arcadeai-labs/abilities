/**
 * `useChat` posts to `/api/chat` by default, which is the route next door, so
 * there is no transport to configure.
 *
 * AI Elements renders the stream: `Conversation` pins the scroll to the bottom
 * while tokens arrive, `MessageResponse` is a streaming-aware markdown renderer,
 * and `Tool` shows each MCP tool call as a collapsible panel. Its `prompt-input`
 * component is deliberately not used — it is written against Radix-flavoured
 * shadcn (`DropdownMenuItem.onSelect(e: Event)`, `HoverCard.openDelay`) and this
 * app's `components/ui` are Base UI (`style: "base-rhea"` in components.json).
 * A textarea and a button are the whole input anyway.
 */
import { useChat } from "@ai-sdk/react"
import { createFileRoute } from "@tanstack/react-router"
import { isToolUIPart } from "ai"
import { useState } from "react"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/chat")({ component: Chat })

function Chat() {
  const { messages, sendMessage, status } = useChat()
  const [input, setInput] = useState("")
  const busy = status === "submitted" || status === "streaming"

  const submit = () => {
    if (!input.trim() || busy) return
    sendMessage({ text: input })
    setInput("")
  }

  return (
    <div className="mx-auto flex h-svh max-w-2xl flex-col gap-4 p-6">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Streamed from /api/chat — tools come from /api/mcp."
              title="Ask the agent"
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      // Parts are positional within a message and carry no id.
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: no stable id
                        <MessageResponse key={index}>
                          {part.text}
                        </MessageResponse>
                      )
                    }

                    if (isToolUIPart(part)) {
                      const done =
                        part.state === "output-available" ||
                        part.state === "output-error"
                      return (
                        <Tool defaultOpen={done} key={part.toolCallId}>
                          {part.type === "dynamic-tool" ? (
                            <ToolHeader
                              state={part.state}
                              toolName={part.toolName}
                              type={part.type}
                            />
                          ) : (
                            <ToolHeader state={part.state} type={part.type} />
                          )}
                          <ToolContent>
                            <ToolInput input={part.input} />
                            <ToolOutput
                              errorText={
                                part.state === "output-error"
                                  ? part.errorText
                                  : undefined
                              }
                              output={
                                part.state === "output-available"
                                  ? part.output
                                  : undefined
                              }
                            />
                          </ToolContent>
                        </Tool>
                      )
                    }

                    return null
                  })}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Textarea
          className="max-h-40 min-h-10 resize-none"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+Enter breaks the line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="What would you like to know?"
          rows={1}
          value={input}
        />
        <Button disabled={busy || !input.trim()} type="submit">
          Send
        </Button>
      </form>
    </div>
  )
}
