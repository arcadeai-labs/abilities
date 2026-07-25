import { syncTools } from "./src/sync";

// CLI entrypoint for the same sync that POST /seed runs. Note that PGlite locks
// its data dir, so stop the server before running this.
const result = await syncTools({
  onPage: ({ page, offset, count, fetched, totalCount }) =>
    console.log(`page ${page}: offset=${offset} +${count} (${fetched}/${totalCount})`),
});

console.log(`\nfetched ${result.unique} unique tools (API total_count: ${result.totalCount})`);
if (result.duplicates) console.log(`collapsed ${result.duplicates} duplicate tool(s) across pages`);
console.log(`swept ${result.swept} row(s) no longer upstream`);
console.log(`rows: ${result.rows} in ${result.durationMs}ms`);

process.exit(0);
