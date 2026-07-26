/**
 * A stored script, read back — behind the run screen rather than in front of it.
 *
 * Everything here is what the author submitted, so it is shown verbatim: the
 * schemas as the JSON Schema they are, and the method as the text that was checked.
 * Order follows how much of it you need to run the thing: what it is, what it takes
 * and returns, then how it does it.
 */
import { TriangleAlertIcon } from "lucide-react"
import type * as React from "react"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScriptMetaBar } from "./script-meta"
import type { ScriptView } from "./types"

function Block({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-heading text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function JsonBlock({
  title,
  filename,
  value,
}: {
  title: string
  filename: string
  value: unknown
}) {
  return (
    <Block title={title}>
      <CodeBlock code={`${JSON.stringify(value, null, 2)}\n`} language="json">
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>{filename}</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    </Block>
  )
}

function ScriptDetails({ script }: { script: ScriptView }) {
  return (
    <div className="flex flex-col gap-6">
      <ScriptMetaBar script={script} />

      {script.stale ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Validated against an older catalog</AlertTitle>
          <AlertDescription>
            This type-checked against snapshot{" "}
            <span className="font-mono">{script.snapshotId}</span>, which is no
            longer current. It still runs; re-validating says whether the tools
            it calls still have the shapes it was written against.
          </AlertDescription>
        </Alert>
      ) : null}

      <JsonBlock
        filename={`${script.name}.input.json`}
        title="Input schema"
        value={script.input}
      />
      <JsonBlock
        filename={`${script.name}.output.json`}
        title="Output schema"
        value={script.output}
      />

      <Block title="run">
        <CodeBlock code={script.run} language="ts" showLineNumbers>
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename>{script.name}.ts</CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      </Block>
    </div>
  )
}

function ScriptDetailsSheet({
  script,
  open,
  onOpenChange,
}: {
  script: ScriptView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">{script.name}</SheetTitle>
          <SheetDescription>
            {script.description ??
              "The contract and the method, exactly as submitted."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <ScriptDetails script={script} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { ScriptDetails, ScriptDetailsSheet }
