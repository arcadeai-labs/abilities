/**
 * The RPC calls the browser makes: list, read, run, delete.
 *
 * Nothing here writes a script. Storing one means validating it against the
 * catalog first, and that whole loop belongs to the agent — which reaches the same
 * routes through `/api/mcp`.
 */
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"
import { signInWithOidc } from "@/lib/auth-client"

export const scriptKeys = {
  all: ["scripts"],
  list: () => [...scriptKeys.all, "list"],
  detail: (name: string) => [...scriptKeys.all, "detail", name],
}

export const toolkitKeys = {
  all: ["toolkits"],
  list: () => [...toolkitKeys.all, "list"],
}

export const authKeys = {
  all: ["auth"],
  me: () => [...authKeys.all, "me"],
}

const OAuthSignInSchema = z.object({
  url: z.string().url().optional(),
  redirect: z.boolean().optional(),
})

type ClientQueryOptions<T> = Omit<
  UseQueryOptions<T, Error>,
  "queryKey" | "queryFn"
>

export function useScripts(options?: ClientQueryOptions<ScriptsList>) {
  return useQuery({
    queryKey: scriptKeys.list(),
    queryFn: fetchScripts,
    ...options,
  })
}

export type ScriptsList = Awaited<ReturnType<typeof fetchScripts>>

async function fetchScripts() {
  const res = await api.scripts.$get()
  if (!res.ok) {
    throw new Error("Failed to list scripts")
  }
  return res.json()
}

export type Script = ScriptsList["scripts"][number]

export function useScript(
  name: string | null,
  options?: ClientQueryOptions<Script>
) {
  return useQuery({
    queryKey: scriptKeys.detail(name ?? ""),
    enabled: Boolean(name),
    queryFn: async () => {
      if (!name) throw new Error("No script name")
      const res = await api.scripts[":name"].$get({ param: { name } })
      if (res.status === 404) {
        throw new Error((await res.json()).message)
      }
      if (!res.ok) {
        throw new Error("Failed to load script")
      }
      return res.json()
    },
    ...options,
  })
}

export function useDeleteScript() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await api.scripts[":name"].$delete({ param: { name } })
      if (res.status === 404) {
        throw new Error((await res.json()).message)
      }
      if (!res.ok) {
        throw new Error("Failed to delete script")
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scriptKeys.all })
    },
  })
}

export type RunScriptBody = {
  input?: unknown
  userId: string
}

export type RunReport = Awaited<ReturnType<typeof fetchRun>>

/** 401 from run — open `authorizationUrl`, then retry. */
export class AuthRecoveryError extends Error {
  readonly authorizationUrl: string

  constructor(message: string, authorizationUrl: string) {
    super(message)
    this.name = "AuthRecoveryError"
    this.authorizationUrl = authorizationUrl
  }
}

async function fetchRun(name: string, body: RunScriptBody) {
  const res = await api.scripts[":name"].run.$post({
    param: { name },
    json: body,
  })
  if (res.status === 401) {
    const err = await res.json()
    const url =
      "authorizationUrl" in err && typeof err.authorizationUrl === "string"
        ? err.authorizationUrl
        : null
    if (url) throw new AuthRecoveryError(err.message, url)
    throw new Error(err.message)
  }
  if (res.status === 404) {
    const err = await res.json()
    throw new Error(err.message)
  }
  // Every other status still returns a run report.
  return res.json()
}

export function useRunScript() {
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: RunScriptBody }) =>
      fetchRun(name, body),
  })
}

async function fetchToolkits() {
  const res = await api.toolkits.$get()
  if (!res.ok) {
    throw new Error("Failed to list toolkits")
  }
  return res.json()
}

export type ToolkitsList = Awaited<ReturnType<typeof fetchToolkits>>

export function useToolkits(options?: ClientQueryOptions<ToolkitsList>) {
  return useQuery({
    queryKey: toolkitKeys.list(),
    queryFn: fetchToolkits,
    ...options,
  })
}

export type Me = Awaited<ReturnType<typeof fetchMe>>

async function fetchMe() {
  const res = await api.me.$get()
  if (!res.ok) {
    throw new Error("Failed to load auth status")
  }
  return res.json()
}

export function useMe(options?: ClientQueryOptions<Me>) {
  return useQuery({
    queryKey: authKeys.me(),
    queryFn: fetchMe,
    ...options,
  })
}

/** Whether the BFF has OIDC env wired up (`useMe` → `configured`). */
export function useAuthConfigured() {
  const me = useMe()
  return {
    ...me,
    data: me.data?.configured ?? null,
  }
}

/** Pull the IdP authorize URL out of a Better Auth oauth2 sign-in result. */
export function oauthRedirectUrl(data: unknown): string | null {
  const parsed = OAuthSignInSchema.safeParse(data)
  return parsed.success ? (parsed.data.url ?? null) : null
}

async function startOidcSignIn(callbackURL = "/") {
  const result = await signInWithOidc(callbackURL)
  if (result.error) {
    throw new Error(result.error.message || "Sign-in failed")
  }
  const url = oauthRedirectUrl(result.data)
  if (!url) {
    throw new Error(
      "Sign-in did not return a redirect URL. Is OIDC configured?"
    )
  }
  return url
}

export function useSignInOidc() {
  return useMutation({
    mutationFn: (callbackURL?: string) => startOidcSignIn(callbackURL),
    onSuccess: (url) => {
      window.location.href = url
    },
  })
}
