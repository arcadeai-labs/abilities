import { defineConfig } from "drizzle-kit"

const url = process.env.POSTGRES_URL

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  ...(url
    ? { dbCredentials: { url } }
    : {
        // Local default: embedded PGlite. The data dir sits at the workspace root
        // so every host opens the same one; see src/paths.ts. drizzle-kit always
        // runs from this package, hence the relative path rather than that lookup.
        driver: "pglite",
        dbCredentials: { url: "../../pgdata" },
      }),
})
