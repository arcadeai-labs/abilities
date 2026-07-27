/**
 * Apply drizzle migrations and exit. With the default PGlite backend, stop the
 * server first — PGlite cannot safely share its data dir across processes. With
 * `POSTGRES_URL` set, a running host can stay up.
 *
 * `pnpm sync` also migrates before writing, so a fresh clone that syncs never
 * needs to call this separately. Use it when you changed a migration and want
 * the schema updated without a catalog pull.
 */
import { closeDb, describeDb, migrateDb } from "./src/db"

console.log(`migrating ${describeDb()}`)
await migrateDb()
await closeDb()
console.log("migrations applied")
