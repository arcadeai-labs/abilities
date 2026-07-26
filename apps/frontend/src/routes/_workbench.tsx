/**
 * Pathless: it adds a frame, not a path segment. `/`, `/scripts/$name` and `/chat`
 * are all children, so the rail and the run panel are mounted once and survive
 * navigation between them.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { Workbench } from "@/components/workbench"

export const Route = createFileRoute("/_workbench")({
  component: WorkbenchLayout,
})

function WorkbenchLayout() {
  return (
    <Workbench>
      <Outlet />
    </Workbench>
  )
}
