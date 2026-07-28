/**
 * What you fill in to run a script, and what comes back.
 *
 * The end user is shown rather than edited: tools execute as that named
 * account with their authorizations — never as the deployment — and a signed-in
 * session locks the field to the user's email. A 401 with an authorization URL
 * is shown here the same way tool grants surface an Authorize link. There is no
 * dry-run: a plausible value generated from a declared shape only proves the
 * shape was declared.
 */
import { UserIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { JsonField } from "./json-field"
import { RunReportPanel } from "./run-report"
import type { RunReportView } from "./types"

function RunPanel({
  userId,
  inputJson,
  onInputJsonChange,
  disabled = false,
  error = null,
  authorizationUrl = null,
  report = null,
}: {
  userId: string
  inputJson: string
  onInputJsonChange: (inputJson: string) => void
  disabled?: boolean
  error?: string | null
  authorizationUrl?: string | null
  report?: RunReportView | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor="run-user">Run as</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <UserIcon />
          </InputGroupAddon>
          <InputGroupInput
            disabled
            id="run-user"
            placeholder="user@example.com"
            value={userId}
          />
        </InputGroup>
        <FieldDescription>
          The Arcade end user. Filled from your signed-in email. Every tool call
          is bounded by what they could already do themselves.
        </FieldDescription>
      </Field>

      <JsonField
        description="Seeded from each property's `default` in the input schema (required fields without one still appear). Checked against that schema before anything runs."
        disabled={disabled}
        id="run-input"
        label="Input"
        onValueChange={onInputJsonChange}
        rows={8}
        value={inputJson}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {authorizationUrl ? "Sign in required" : "Could not run"}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{error}</span>
            {authorizationUrl ? (
              <Button
                className="w-fit"
                nativeButton={false}
                render={
                  <a href={authorizationUrl} rel="noreferrer" target="_blank" />
                }
                size="sm"
                variant="outline"
              >
                Sign in
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {report ? <RunReportPanel report={report} /> : null}
    </div>
  )
}

export { RunPanel }
