import { expect, test } from "vitest"

import { defaultInputFromSchema, defaultInputJson } from "./default-input"

test("uses a root-level default when present", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      default: { owner: "arcadeai" },
      properties: { owner: { type: "string", default: "other" } },
    })
  ).toEqual({ owner: "arcadeai" })
})

test("collects property defaults and placeholders for required fields without one", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      properties: {
        owner: { type: "string", default: "arcadeai" },
        repo: { type: "string", default: "arcade-ai" },
        number: { type: "integer" },
      },
      required: ["owner", "repo", "number"],
    })
  ).toEqual({ owner: "arcadeai", repo: "arcade-ai", number: 0 })
})

test("skips optional properties without a default", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      properties: {
        owner: { type: "string" },
        limit: { type: "integer", default: 25 },
      },
    })
  ).toEqual({ limit: 25 })
})

test("returns an empty object when nothing declares a default or required field", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      properties: { owner: { type: "string" } },
    })
  ).toEqual({})
  expect(defaultInputFromSchema(null)).toEqual({})
  expect(defaultInputFromSchema("nope")).toEqual({})
})

test("placeholders respect enum, const, minimum, and minLength", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["issue", "pr"] },
        fixed: { const: "v1" },
        count: { type: "integer", minimum: 3 },
        name: { type: "string", minLength: 4 },
        tags: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["kind", "fixed", "count", "name", "tags"],
    })
  ).toEqual({
    kind: "issue",
    fixed: "v1",
    count: 3,
    name: "xxxx",
    tags: [""],
  })
})

test("pretty-prints for the textarea", () => {
  expect(
    defaultInputJson({
      type: "object",
      properties: { limit: { type: "integer", default: 25 } },
    })
  ).toBe('{\n  "limit": 25\n}\n')
})
