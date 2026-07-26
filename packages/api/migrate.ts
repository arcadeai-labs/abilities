/**
 * Apply drizzle migrations and exit. Stop the server first — PGlite holds an
 * exclusive lock on the data dir, so this and a running host cannot share it.
 *
 * `pnpm sync` also migrates before writing, so a fresh clone that syncs never
 * needs to call this separately. Use it when you changed a migration and want
 * the schema updated without a catalog pull.
 */
import { closeDb, migrateDb } from "./src/db";

await migrateDb();
await closeDb();
console.log("migrations applied");
