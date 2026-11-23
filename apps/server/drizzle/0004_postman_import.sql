CREATE TABLE "import_links" (
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"local_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_links_workspace_id_provider_entity_external_id_pk" PRIMARY KEY("workspace_id","provider","entity","external_id")
);
--> statement-breakpoint
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_links_local_idx" ON "import_links" USING btree ("local_id");