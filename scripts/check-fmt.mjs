import { spawnSync } from "node:child_process"

const result = spawnSync("biome", ["check", "--reporter=json", "."], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

const stdout = result.stdout?.trim() ?? ""
if (!stdout) {
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

let report
try {
  report = JSON.parse(stdout)
} catch {
  if (result.stderr) process.stderr.write(result.stderr)
  process.stdout.write(result.stdout)
  process.exit(result.status ?? 1)
}

const FIX_RE = /\b(Safe|Unsafe) fix:/i

function isAutoFixable(diagnostic) {
  const category = diagnostic.category ?? ""
  if (category === "format" || category.startsWith("assist/")) {
    return true
  }
  return (diagnostic.advices ?? []).some((advice) =>
    FIX_RE.test(advice.text ?? "")
  )
}

const unfixable = (report.diagnostics ?? []).filter(
  (diagnostic) => !isAutoFixable(diagnostic)
)

if (unfixable.length === 0) {
  console.log("No issues that cannot be auto-fixed.")
  process.exit(0)
}

for (const diagnostic of unfixable) {
  const { path, start } = diagnostic.location ?? {}
  const loc =
    path && start
      ? `${path}:${start.line}:${start.column}`
      : (path ?? "<unknown>")
  const category = diagnostic.category ? `${diagnostic.category} ` : ""
  console.error(`${loc}\n  ${category}${diagnostic.message}\n`)
}

console.error(
  `Found ${unfixable.length} issue(s) that cannot be auto-fixed. Run \`pnpm fmt\` for auto-fixable ones.`
)
process.exit(1)
