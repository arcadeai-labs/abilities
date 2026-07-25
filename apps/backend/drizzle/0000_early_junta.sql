CREATE TABLE "tools" (
	"fully_qualified_name" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"qualified_name" text NOT NULL,
	"description" text,
	"toolkit_name" text NOT NULL,
	"toolkit_description" text,
	"toolkit_version" text,
	"input" jsonb,
	"output" jsonb,
	"requirements" jsonb,
	"metadata" jsonb,
	"formatted_schema" jsonb,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tools_toolkit_name_idx" ON "tools" USING btree ("toolkit_name");--> statement-breakpoint
CREATE INDEX "tools_name_idx" ON "tools" USING btree ("name");