/**
 * Renders each pane to a string and checks what a reader would actually see.
 *
 * Server rendering rather than a DOM: the panes hold no state of their own, they are
 * what the route sends over the wire, and the content worth guarding — the derived
 * counts, the stale warning, the schemas as submitted — is all in the first paint.
 * The costs are that only the active tab's panel exists, which is why the run report
 * is asserted through its labels, and that a `Sheet` portals out, which is why the
 * details are asserted through `ScriptDetails` rather than through its sheet.
 */
import type * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"

import { ChatPane } from "@/components/chat/chat-pane"
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar"
import { sampleScripts, successfulRun } from "./fixtures"
import { RunPanel } from "./run-panel"
import { ScriptDetails } from "./script-detail"
import { ScriptNav } from "./script-nav"
import {
  BrowsePane,
  ScriptLoadingPane,
  ScriptMissingPane,
  ScriptRunPane,
} from "./script-panes"

const noop = () => undefined

/** Every pane's header carries the rail's trigger, so all of them need the shell. */
const inShell = (node: React.ReactNode) =>
  renderToStaticMarkup(<SidebarProvider>{node}</SidebarProvider>)

const scriptNamed = (name: string) => {
  const script = sampleScripts.find((entry) => entry.name === name)
  if (!script) throw new Error(`fixture ${name} is missing`)
  return script
}

const runPane = (name: string) =>
  inShell(
    <ScriptRunPane
      inputJson="{}"
      onDelete={noop}
      onInputJsonChange={noop}
      onRun={noop}
      onShowDetails={noop}
      onUserIdChange={noop}
      script={scriptNamed(name)}
      userId="user"
    />
  )

test("browse pane lists every script", () => {
  const html = inShell(
    <BrowsePane
      onDelete={noop}
      onOpen={noop}
      scripts={sampleScripts}
      snapshotId="snap_2026_07_24"
    />
  )
  expect(html).toContain("summarize-issue")
  expect(html).toContain("triage-inbox")
  expect(html).toContain("1 tool granted")
  expect(html).toContain("snap_2026_07_24 · 1 stale")
})

/** Nothing stored: the only way to get a script is to ask the agent for one. */
test("browse pane empty state points at the agent", () => {
  const html = inShell(
    <BrowsePane onDelete={noop} onOpen={noop} scripts={[]} />
  )
  expect(html).toContain("No scripts yet")
  expect(html).toContain("Ask the agent for one")
  expect(html).not.toContain("New script")
})

/** A script's page leads with running it, not with reading it. */
test("script page is the run screen", () => {
  const html = runPane("summarize-issue")
  expect(html).toContain("summarize-issue")
  expect(html).toContain("Run as")
  expect(html).toContain("Input")
  expect(html).toContain("Run")
  expect(html).toContain("Contract and code")
  // The code and the schemas are in the sheet, so they are not in the pane.
  expect(html).not.toContain("summarize-issue.ts")
  expect(html).not.toContain("issueNumber")
})

/**
 * The scopes are the interesting half: they come from the calls, so a toolkit that
 * is declared and never called asks for nothing. The hover card is portalled and
 * only opens on pointer, so what is asserted here is the trigger for each toolkit.
 */
test("run screen names every toolkit in scope", () => {
  const html = runPane("digest-releases")
  expect(html).toContain("Toolkits")
  expect(html).toContain("github")
  expect(html).toContain("slack")
  expect(html).toContain("Hover for the scopes")
})

test("stale scripts still run, and say so", () => {
  const html = runPane("triage-inbox")
  expect(html).toContain("Stale")
  expect(html).toContain("Run as")
})

/** The sheet: metadata, the contract as submitted, then the method. */
test("details show the schemas as JSON and the method as text", () => {
  const html = renderToStaticMarkup(
    <ScriptDetails script={scriptNamed("summarize-issue")} />
  )
  expect(html).toContain("scr_01hq9k3m7x")
  expect(html).toContain("Github.GetIssue")
  expect(html).toContain("Input schema")
  expect(html).toContain("Output schema")
  expect(html).toContain("summarize-issue.input.json")
  expect(html).toContain("summarize-issue.ts")
  // Raw JSON Schema, not a rendered field list. React escapes the quotes.
  expect(html).toContain("&quot;properties&quot;")
  expect(html).toContain("&quot;required&quot;")
  expect(html).not.toContain("optional")
})

test("stale details name the snapshot they were checked against", () => {
  const html = renderToStaticMarkup(
    <ScriptDetails script={scriptNamed("triage-inbox")} />
  )
  expect(html).toContain("Validated against an older catalog")
  expect(html).toContain("snap_2026_06_11")
})

/** Read, run, delete — writing a script is the agent's job, not this screen's. */
test("no pane offers to write a script", () => {
  const browse = inShell(
    <BrowsePane onDelete={noop} onOpen={noop} scripts={sampleScripts} />
  )
  for (const html of [browse, runPane("add-numbers")]) {
    expect(html).not.toContain("Edit")
    expect(html).not.toContain("New script")
    expect(html).not.toContain("Validate")
  }
})

/** `/scripts/:name` is a URL, so it can be opened cold or point at nothing. */
test("a deep link names the script it is waiting for, or missing", () => {
  const loading = inShell(<ScriptLoadingPane name="summarize-issue" />)
  expect(loading).toContain("summarize-issue")
  expect(loading).toContain("Loading")

  const missing = inShell(
    <ScriptMissingPane message="No such script." name="ghost" />
  )
  expect(missing).toContain("No script called ghost")
  expect(missing).toContain("No such script.")
})

/** The agent is a third pane, mounted where the script was and naming its way out. */
test("chat pane replaces the script it was opened from", () => {
  const html = inShell(
    <ChatPane backLabel="Back to add-numbers" onClose={noop}>
      <p>transcript</p>
    </ChatPane>
  )
  expect(html).toContain("Agent")
  expect(html).toContain("Back to add-numbers")
  expect(html).toContain("transcript")
})

test("nav lists scripts without a filter", () => {
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <Sidebar collapsible="none">
        <ScriptNav
          onSelect={noop}
          scripts={sampleScripts}
          selectedName="triage-inbox"
        />
      </Sidebar>
    </SidebarProvider>
  )
  expect(html).toContain("4 stored")
  expect(html).toContain("triage-inbox")
  expect(html).toContain("add-numbers")
  expect(html).not.toContain("Filter scripts")
})

test("run panel reports the outcome, the calls and the drift", () => {
  const html = renderToStaticMarkup(
    <RunPanel
      inputJson="{}"
      onInputJsonChange={noop}
      onUserIdChange={noop}
      report={successfulRun}
      userId="user"
    />
  )
  // Only the active tab's panel renders, so the tool-call table is a label here.
  expect(html).toContain("Returned successfully")
  expect(html).toContain("Tool calls (1)")
  expect(html).toContain("Drift (1)")
  expect(html).toContain("fetched issue 481")
  expect(html).toContain("Streaming breaks on reconnect")
})
