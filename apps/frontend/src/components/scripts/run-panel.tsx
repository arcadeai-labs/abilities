/**
 * What you fill in to run a script, and what comes back.
 *
 * The user id is a field rather than a setting because tools execute as a named
 * end user with that user's authorizations — never as the deployment — so it is
 * part of the run, not of the app. There is no dry-run: a plausible value
 * generated from a declared shape only proves the shape was declared.
 */
import { UserIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  onUserIdChange,
  inputJson,
  onInputJsonChange,
  disabled = false,
  error = null,
  report = null,
}: {
  userId: string
  onUserIdChange: (userId: string) => void
  inputJson: string
  onInputJsonChange: (inputJson: string) => void
  disabled?: boolean
  error?: string | null
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
            disabled={disabled}
            id="run-user"
            onChange={(event) => onUserIdChange(event.target.value)}
            placeholder="user@example.com"
            value={userId}
          />
        </InputGroup>
        <FieldDescription>
          The Arcade end user. Every tool call is bounded by what they could
          already do themselves.
        </FieldDescription>
      </Field>

      <JsonField
        description="Checked against the script's declared input schema before anything runs."
        disabled={disabled}
        id="run-input"
        label="Input"
        onValueChange={onInputJsonChange}
        rows={8}
        value={inputJson}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {report ? <RunReportPanel report={report} /> : null}
    </div>
  )
}

export { RunPanel }
