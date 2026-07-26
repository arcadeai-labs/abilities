/**
 * A run report, which is never just "did it work".
 *
 * The outcome is one of seven kinds and each carries a different payload, so it
 * is narrowed here with the same discriminant the wire format uses — `outcome`
 * arrives as `unknown` on purpose. Logs, tool calls and drift are worth reading
 * even on success: drift in particular is *not* a failure, it is the catalog's
 * declared shape disagreeing with what a tool really returned.
 */
import {
  CircleCheckIcon,
  CircleXIcon,
  LockIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type * as React from "react"
import { z } from "zod"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { RunReportView } from "./types"

const KindSchema = z.looseObject({ kind: z.string() })
const OutputSchema = z.looseObject({ output: z.unknown() })
const ViolationsSchema = z.looseObject({
  violations: z.array(z.looseObject({ path: z.string(), message: z.string() })),
})
const AuthorizationSchema = z.looseObject({
  tools: z.array(
    z.looseObject({
      qualifiedName: z.string(),
      authUrl: z.string().optional(),
    })
  ),
})
const MessageSchema = z.looseObject({ message: z.string() })

type Summary = {
  kind: string
  title: string
  description: string
  failed: boolean
  icon: React.ReactNode
}

function summarize(outcome: unknown): Summary {
  const parsed = KindSchema.safeParse(outcome)
  const kind = parsed.success ? parsed.data.kind : "unknown"

  switch (kind) {
    case "ok":
      return {
        kind,
        title: "Returned successfully",
        description: "The return value satisfied the declared output schema.",
        failed: false,
        icon: <CircleCheckIcon />,
      }
    case "input_invalid":
      return {
        kind,
        title: "Input did not match the contract",
        description: "Nothing ran — the input is checked before the sandbox.",
        failed: true,
        icon: <CircleXIcon />,
      }
    case "contract_violation":
      return {
        kind,
        title: "Return value did not match the contract",
        description:
          "The script ran to completion, but its output was rejected.",
        failed: true,
        icon: <CircleXIcon />,
      }
    case "authorization_required":
      return {
        kind,
        title: "Authorization required",
        description:
          "Tools run as the named end user. Grant the scopes below and run again.",
        failed: false,
        icon: <LockIcon />,
      }
    case "script_error":
      return {
        kind,
        title: "The script threw",
        description: "An error escaped run and reached the host.",
        failed: true,
        icon: <CircleXIcon />,
      }
    case "tool_error":
      return {
        kind,
        title: "A tool failed",
        description: "The failure is upstream, not in the script's own code.",
        failed: true,
        icon: <CircleXIcon />,
      }
    case "limit_exceeded":
      return {
        kind,
        title: "Limit exceeded",
        description: "The sandbox stopped the run before it finished.",
        failed: true,
        icon: <TriangleAlertIcon />,
      }
    default:
      return {
        kind,
        title: "Unrecognized outcome",
        description: "Read the raw report below.",
        failed: true,
        icon: <TriangleAlertIcon />,
      }
  }
}

function ViolationItems({
  violations,
}: {
  violations: { path: string; message: string }[]
}) {
  return (
    <ItemGroup className="gap-2">
      {violations.map((violation) => (
        <Item
          key={`${violation.path}:${violation.message}`}
          size="sm"
          variant="muted"
        >
          <ItemContent>
            <ItemTitle className="font-mono">
              {violation.path || "(root)"}
            </ItemTitle>
            <ItemDescription className="line-clamp-none">
              {violation.message}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}

/** The part of the outcome that is specific to its kind. */
function OutcomeDetail({ outcome }: { outcome: unknown }) {
  const kind = KindSchema.safeParse(outcome)

  if (!kind.success) {
    return null
  }

  if (kind.data.kind === "ok") {
    const parsed = OutputSchema.safeParse(outcome)
    return (
      <CodeBlock
        code={`${JSON.stringify(parsed.success ? parsed.data.output : null, null, 2)}\n`}
        language="json"
      >
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>output.json</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    )
  }

  if (
    kind.data.kind === "input_invalid" ||
    kind.data.kind === "contract_violation"
  ) {
    const parsed = ViolationsSchema.safeParse(outcome)
    return parsed.success ? (
      <ViolationItems violations={parsed.data.violations} />
    ) : null
  }

  if (kind.data.kind === "authorization_required") {
    const parsed = AuthorizationSchema.safeParse(outcome)
    return parsed.success ? (
      <ItemGroup className="gap-2">
        {parsed.data.tools.map((tool) => (
          <Item key={tool.qualifiedName} size="sm" variant="outline">
            <ItemContent>
              <ItemTitle className="font-mono">{tool.qualifiedName}</ItemTitle>
            </ItemContent>
            {tool.authUrl ? (
              <Button
                nativeButton={false}
                render={
                  <a href={tool.authUrl} rel="noreferrer" target="_blank" />
                }
                size="sm"
                variant="outline"
              >
                Authorize
              </Button>
            ) : null}
          </Item>
        ))}
      </ItemGroup>
    ) : null
  }

  const parsed = MessageSchema.safeParse(outcome)
  return parsed.success ? (
    <pre className="overflow-x-auto rounded-2xl border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
      {parsed.data.message}
    </pre>
  ) : null
}

function RunReportPanel({ report }: { report: RunReportView }) {
  const summary = summarize(report.outcome)
  const failedCalls = report.toolCalls.filter((call) => !call.ok).length

  return (
    <div className="flex flex-col gap-4">
      <Alert variant={summary.failed ? "destructive" : "default"}>
        {summary.icon}
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {summary.title}
          <Badge className="font-mono" variant="outline">
            {summary.kind}
          </Badge>
        </AlertTitle>
        <AlertDescription>{summary.description}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">{report.runId}</span>
        <span>{report.durationMs} ms</span>
        <span>
          {report.toolCalls.length} tool{" "}
          {report.toolCalls.length === 1 ? "call" : "calls"}
          {failedCalls > 0 ? `, ${failedCalls} failed` : ""}
        </span>
      </div>

      <OutcomeDetail outcome={report.outcome} />

      <Tabs defaultValue="logs">
        <TabsList variant="line">
          <TabsTrigger value="logs">Logs ({report.logs.length})</TabsTrigger>
          <TabsTrigger value="calls">
            Tool calls ({report.toolCalls.length})
          </TabsTrigger>
          <TabsTrigger value="drift">Drift ({report.drift.length})</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>

        <TabsContent className="pt-3" value="logs">
          {report.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The script logged nothing.
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-2xl border bg-muted/40 p-3 font-mono text-xs">
              {report.logs.map((line, index) => (
                // Logs are append-only and two lines can read the same; the
                // position in the run is the only thing that identifies one.
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable id
                <span className="flex gap-3" key={index}>
                  <span className="w-6 shrink-0 text-right text-muted-foreground/60">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words whitespace-pre-wrap">
                    {line}
                  </span>
                </span>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent className="pt-3" value="calls">
          {report.toolCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool was called.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Call</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.toolCalls.map((call) => (
                  <TableRow key={`${call.path}:${call.qualifiedName}`}>
                    <TableCell className="font-mono">{call.path}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {call.qualifiedName}
                    </TableCell>
                    <TableCell>{call.durationMs} ms</TableCell>
                    <TableCell>
                      {call.ok ? (
                        <Badge variant="secondary">ok</Badge>
                      ) : (
                        <Badge title={call.error} variant="destructive">
                          {call.error ?? "failed"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent className="pt-3" value="drift">
          {report.drift.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every tool returned the shape the catalog declares.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {report.drift.map((entry) => (
                <div className="flex flex-col gap-2" key={entry.tool}>
                  <span className="font-mono text-sm">{entry.tool}</span>
                  <ViolationItems violations={entry.violations} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent className="pt-3" value="raw">
          <CodeBlock
            code={`${JSON.stringify(report, null, 2)}\n`}
            language="json"
          >
            <CodeBlockHeader>
              <CodeBlockTitle>
                <CodeBlockFilename>report.json</CodeBlockFilename>
              </CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton />
              </CodeBlockActions>
            </CodeBlockHeader>
          </CodeBlock>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export { RunReportPanel }
