import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"

export const scriptKeys = {
  all: ["scripts"],
  list: () => [...scriptKeys.all, "list"],
  detail: (name: string) => [...scriptKeys.all, "detail", name],
}

export const toolkitKeys = {
  all: ["toolkits"],
  list: () => [...toolkitKeys.all, "list"],
}

const JsonObjectSchema = z.record(z.string(), z.unknown())

export function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("Invalid JSON")
  }
  return JsonObjectSchema.parse(value)
}

export function parseToolkits(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

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

export type UpsertScriptBody = {
  description?: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  toolkits: string[]
  run: string
}

export type UpsertScriptResult =
  | { kind: "ok"; script: Script; created: boolean }
  | {
      kind: "invalid"
      validation: {
        ok: boolean
        diagnostics: { code: string; message: string }[]
      }
    }
  | { kind: "bad_name"; message: string }

export type ValidationResult = Awaited<ReturnType<typeof fetchValidate>>

async function fetchValidate(body: UpsertScriptBody) {
  const res = await api.validate.$post({ json: body })
  if (!res.ok) {
    throw new Error("Failed to validate script")
  }
  return res.json()
}

export function useValidateScript() {
  return useMutation({
    mutationFn: (body: UpsertScriptBody) => fetchValidate(body),
  })
}

export function useUpsertScript() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      body,
    }: {
      name: string
      body: UpsertScriptBody
    }): Promise<UpsertScriptResult> => {
      const res = await api.scripts[":name"].$put({
        param: { name },
        json: body,
      })
      if (res.status === 422) {
        return { kind: "invalid", validation: await res.json() }
      }
      if (res.status === 400) {
        return { kind: "bad_name", message: (await res.json()).message }
      }
      if (res.status === 201) {
        return { kind: "ok", script: await res.json(), created: true }
      }
      if (res.status === 200) {
        return { kind: "ok", script: await res.json(), created: false }
      }
      throw new Error("Failed to save script")
    },
    onSuccess: (result) => {
      if (result.kind === "ok") {
        void queryClient.invalidateQueries({ queryKey: scriptKeys.all })
      }
    },
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

async function fetchRun(name: string, body: RunScriptBody) {
  const res = await api.scripts[":name"].run.$post({
    param: { name },
    json: body,
  })
  if (res.status === 404) {
    throw new Error((await res.json()).message)
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
