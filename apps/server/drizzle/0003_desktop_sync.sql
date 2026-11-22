CREATE TABLE "deletions" (
	"workspace_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletions_entity_entity_id_pk" PRIMARY KEY("entity","entity_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "globals_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "globals_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "deletions" ADD CONSTRAINT "deletions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletions_ws_idx" ON "deletions" USING btree ("workspace_id","deleted_at");