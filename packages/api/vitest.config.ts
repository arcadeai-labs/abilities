import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // PGlite takes an exclusive lock on the data dir, so the whole suite has to be
    // one process holding one handle. `isolate: false` also means the files share a
    // module registry, so `db.ts` is evaluated once and its handle is reused.
    fileParallelism: false,
    isolate: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Every suite calls the real Arcade API; a round trip dwarfs the compute.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
