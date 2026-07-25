import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { tools } from "./schema";

export const DATA_DIR = process.env.PGLITE_DATA_DIR ?? "./pgdata";

/**
 * Single PGlite instance per process — PGlite takes an exclusive lock on the
 * data dir, so the server and the sync script must not hold it concurrently.
 */
export const pg = await PGlite.create(DATA_DIR);

export const db = drizzle({ client: pg, schema: { tools } });

export type Db = typeof db;

let migrated: Promise<void> | undefined;

/** Idempotent: drizzle tracks applied migrations, and we only run it once per process. */
export const ensureMigrated = () => (migrated ??= migrate(db, { migrationsFolder: "./drizzle" }));
