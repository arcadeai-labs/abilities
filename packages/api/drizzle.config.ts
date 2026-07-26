import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  // The data dir sits at the workspace root so every host opens the same one; see
  // src/paths.ts. drizzle-kit always runs from this package, hence the relative
  // path rather than that lookup.
  dbCredentials: { url: "../../pgdata" },
})
