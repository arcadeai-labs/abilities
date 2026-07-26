CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"script_version" integer NOT NULL,
	"user_id" text NOT NULL,
	"input" jsonb,
	"outcome" jsonb,
	"logs" jsonb,
	"tool_calls" jsonb,
	"duration_ms" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"compiled" text NOT NULL,
	"source_hash" text NOT NULL,
	"tool_grant" jsonb NOT NULL,
	"namespaces" jsonb NOT NULL,
	"contract" jsonb NOT NULL,
	"snapshot_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scripts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE INDEX "runs_script_id_idx" ON "runs" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at");