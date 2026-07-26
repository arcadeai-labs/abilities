/**
 * A JSON textarea that says whether it holds JSON.
 *
 * The check is the same `JSON.parse` the submit path runs, so the badge is not an
 * approximation of what the API will say — it is the first half of it, moved to
 * where the typing happens. Reformatting is offered only while the text parses,
 * for the same reason.
 */
import { CheckIcon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

function jsonStatus(text: string) {
  if (!text.trim()) return { ok: false, label: "Empty" }
  try {
    JSON.parse(text)
    return { ok: true, label: "Valid JSON" }
  } catch {
    return { ok: false, label: "Invalid JSON" }
  }
}

function JsonField({
  id,
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  rows = 12,
  className,
}: {
  id: string
  label: string
  description?: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  rows?: number
  className?: string
}) {
  const status = jsonStatus(value)

  const format = () => {
    try {
      onValueChange(`${JSON.stringify(JSON.parse(value), null, 2)}\n`)
    } catch {
      // Unreachable while the button is rendered; the status gate is the guard.
    }
  }

  return (
    <Field className={className}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="flex items-center gap-1.5">
          {status.ok ? (
            <>
              <Button
                disabled={disabled}
                onClick={format}
                size="xs"
                type="button"
                variant="ghost"
              >
                <WandSparklesIcon />
                Format
              </Button>
              <Badge className="text-muted-foreground" variant="ghost">
                <CheckIcon />
                {status.label}
              </Badge>
            </>
          ) : (
            <Badge variant="destructive">
              <TriangleAlertIcon />
              {status.label}
            </Badge>
          )}
        </div>
      </div>
      <Textarea
        aria-invalid={!status.ok}
        className={cn("min-h-40 font-mono text-xs leading-relaxed")}
        disabled={disabled}
        id={id}
        onChange={(event) => onValueChange(event.target.value)}
        rows={rows}
        spellCheck={false}
        value={value}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

export { JsonField, jsonStatus }
