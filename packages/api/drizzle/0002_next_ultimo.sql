-- Scripts are now stored as their parts — the `run` method plus the contract as
-- JSON Schema — rather than as a hand-written module. Existing rows cannot come
-- across: their `source` is a module in a format validation now rejects (it
-- imported `arcade:runtime`), and none of the new required columns can be derived
-- from it. There is nothing to preserve, so the rows go.
DELETE FROM "scripts";--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "run" text NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "input_schema" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "output_schema" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "expect_schemas" jsonb DEFAULT '{}'::jsonb NOT NULL;
