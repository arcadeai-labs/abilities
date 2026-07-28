/**
 * Dev sign-in is the one auth path with nothing upstream of it, so unlike the rest
 * of the suite this file needs no API key and no catalog — it drives the real routes
 * and reads the real cookies.
 *
 * Every case sets its own env: `authMode()` and friends read `process.env` per call
 * precisely so that a machine with OIDC credentials in `.env` behaves the same here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import app from "./app"

const MANAGED = [
  "DEV_AUTH",
  "DEV_AUTH_USER",
  "NODE_ENV",
  "VERCEL_ENV",
  "BETTER_AUTH_SECRET",
  "OIDC_CLIENT_ID",
  "OIDC_DISCOVERY_URL",
] as const

const DEV_USER = "dev@example.invalid"

let saved: Partial<Record<(typeof MANAGED)[number], string | undefined>> = {}

beforeEach(() => {
  saved = Object.fromEntries(MANAGED.map((key) => [key, process.env[key]]))
  for (const key of MANAGED) delete process.env[key]
  process.env.DEV_AUTH = "true"
  process.env.DEV_AUTH_USER = DEV_USER
})

afterEach(() => {
  for (const key of MANAGED) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const getSession = (cookie?: string) =>
  app.request("/api/auth/get-session", {
    headers: cookie ? { cookie } : {},
  })

/** The `Set-Cookie` a response sends back, as a browser would send it next time. */
const cookieFrom = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? ""
  return header.split(";")[0] ?? ""
}

describe("dev sign-in", () => {
  it("reports the mode and a session with no request cookies at all", async () => {
    const response = await app.request("/api/me")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      mode: "dev",
      user: {
        id: `dev_${DEV_USER}`,
        accountId: DEV_USER,
        email: DEV_USER,
        name: "Dev user",
        image: null,
      },
    })
  })

  it("answers get-session in Better Auth's shape, so the browser client is unchanged", async () => {
    const body = await (await getSession()).json()

    // What `authClient.useSession()` reads, and what the rail mirrors into the
    // run-as atom.
    expect(body).toMatchObject({
      session: { userId: `dev_${DEV_USER}` },
      user: { accountId: DEV_USER, emailVerified: true },
    })
  })

  it("signs out with a cookie, and back in by clearing it", async () => {
    const signOut = await app.request("/api/auth/sign-out", { method: "POST" })
    expect(await signOut.json()).toEqual({ success: true })

    const cookie = cookieFrom(signOut)
    expect(cookie).toBe("returntypes.dev_signed_out=1")
    expect(await (await getSession(cookie)).json()).toBeNull()
    expect(
      await (await app.request("/api/me", { headers: { cookie } })).json()
    ).toEqual({ mode: "dev", user: null })

    const signIn = await app.request("/api/auth/sign-in/oauth2", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ providerId: "oidc", callbackURL: "/scripts" }),
    })

    expect(await signIn.json()).toEqual({ redirect: true, url: "/scripts" })
    // Cleared: the browser drops it, and an empty value reads as absent regardless.
    expect(signIn.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(await (await getSession(cookieFrom(signIn))).json()).not.toBeNull()
  })

  it("will not redirect off-origin after sign-in", async () => {
    for (const callbackURL of ["https://evil.example/", "//evil.example/"]) {
      const response = await app.request("/api/auth/sign-in/oauth2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callbackURL }),
      })
      expect(await response.json()).toEqual({ redirect: true, url: "/" })
    }
  })

  it("does not pretend to serve the rest of Better Auth", async () => {
    const response = await app.request("/api/auth/oauth2/callback/oidc")

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: "dev_auth_unsupported",
    })
  })

  it("refuses in production, where nothing would be authenticating anybody", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.NODE_ENV = "production"

    expect(await (await app.request("/api/me")).json()).toEqual({
      mode: "off",
      user: null,
    })
    // No OIDC env either, so login is simply unavailable — not faked.
    expect((await getSession()).status).toBe(503)
    warn.mockRestore()
  })

  it("still engages on a Vercel preview, which builds as production", async () => {
    // The case dev auth exists for: NODE_ENV says production, the deployment is not.
    process.env.NODE_ENV = "production"
    process.env.VERCEL_ENV = "preview"

    expect(await (await app.request("/api/me")).json()).toMatchObject({
      mode: "dev",
      user: { accountId: DEV_USER },
    })
  })

  it("refuses on the production deployment even when NODE_ENV is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.VERCEL_ENV = "production"

    expect(await (await app.request("/api/me")).json()).toEqual({
      mode: "off",
      user: null,
    })
    warn.mockRestore()
  })

  it("is off when DEV_AUTH is not set", async () => {
    delete process.env.DEV_AUTH

    expect(await (await app.request("/api/me")).json()).toEqual({
      mode: "off",
      user: null,
    })
  })
})
