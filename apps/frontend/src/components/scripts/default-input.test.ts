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

test("collects property defaults and skips properties without one", () => {
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
  ).toEqual({ owner: "arcadeai", repo: "arcade-ai" })
})

test("returns an empty object when nothing declares a default", () => {
  expect(
    defaultInputFromSchema({
      type: "object",
      properties: { owner: { type: "string" } },
    })
  ).toEqual({})
  expect(defaultInputFromSchema(null)).toEqual({})
  expect(defaultInputFromSchema("nope")).toEqual({})
})

test("pretty-prints for the textarea", () => {
  expect(
    defaultInputJson({
      type: "object",
      properties: { limit: { type: "integer", default: 25 } },
    })
  ).toBe('{\n  "limit": 25\n}\n')
})
