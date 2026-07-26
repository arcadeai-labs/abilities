import { createFileRoute } from "@tanstack/react-router"
import { ScriptsApp } from "@/components/scripts-app"

export const Route = createFileRoute("/")({ component: ScriptsApp })
