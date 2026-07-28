/**
 * `authBaseURL()` is the host in the `redirect_uri` the IdP is handed, which makes it
 * the difference between login working and login looping. Nothing here reaches the
 * network, so like ./dev-auth.test.ts this suite needs no API key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { authBaseURL } from "./auth"

const MANAGED = [
  "BETTER_AUTH_URL",
  "PORTLESS_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const

let saved: Partial<Record<(typeof MANAGED)[number], string | undefined>> = {}

beforeEach(() => {
  saved = Object.fromEntries(MANAGED.map((key) => [key, process.env[key]]))
  for (const key of MANAGED) delete process.env[key]
})

afterEach(() => {
  for (const key of MANAGED) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("authBaseURL", () => {
  it("prefers an explicit BETTER_AUTH_URL over anything it could infer", () => {
    process.env.BETTER_AUTH_URL = "https://scripts.example.com"
    process.env.PORTLESS_URL = "https://returntypes.localhost"
    process.env.VERCEL_URL = "deployment.vercel.app"

    expect(authBaseURL()).toBe("https://scripts.example.com")
  })

  it("uses the portless origin under `pnpm dev`", () => {
    process.env.PORTLESS_URL = "https://thimphu.returntypes.localhost"

    expect(authBaseURL()).toBe("https://thimphu.returntypes.localhost")
  })

  it("names the production domain on the production deployment", () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "abilities.vercel.app"
    process.env.VERCEL_URL = "abilities-abc123.vercel.app"

    expect(authBaseURL()).toBe("https://abilities.vercel.app")
  })

  it("prefers the branch URL on a preview, since a per-deployment host is unregisterable", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_BRANCH_URL = "abilities-git-thimphu.vercel.app"
    process.env.VERCEL_URL = "abilities-abc123.vercel.app"

    expect(authBaseURL()).toBe("https://abilities-git-thimphu.vercel.app")
  })

  it("falls back to the deployment's own URL when there is no branch URL", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_URL = "abilities-abc123.vercel.app"

    expect(authBaseURL()).toBe("https://abilities-abc123.vercel.app")
  })

  it("only reaches localhost when nothing has said otherwise", () => {
    expect(authBaseURL()).toBe("http://localhost:3000")
  })
})
