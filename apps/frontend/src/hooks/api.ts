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
