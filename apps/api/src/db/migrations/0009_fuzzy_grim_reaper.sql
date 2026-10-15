CREATE TYPE "public"."mock_response_mode" AS ENUM('static', 'dynamic');--> statement-breakpoint
CREATE TYPE "public"."mock_source_type" AS ENUM('file', 'url');--> statement-breakpoint
CREATE TYPE "public"."mock_status" AS ENUM('running', 'paused');--> statement-breakpoint
CREATE TYPE "public"."mock_version_action" AS ENUM('create', 'replace', 'resync', 'restore');--> statement-breakpoint
CREATE TYPE "public"."schema_format" AS ENUM('openapi3', 'postman2');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "mock_usage_hourly" (
	"mock_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"client_errors" integer DEFAULT 0 NOT NULL,
	"server_errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mock_usage_hourly_mock_id_hour_pk" PRIMARY KEY("mock_id","hour")
);
--> statement-breakpoint
CREATE TABLE "mock_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mock_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"action" "mock_version_action" NOT NULL,
	"source_label" text NOT NULL,
	"restored_from" integer,
	"format" "schema_format" NOT NULL,
	"spec_version" text NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"endpoint_count" integer NOT NULL,
	"example_count" integer NOT NULL,
	"operations" jsonb NOT NULL,
	"diff" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"status" "mock_status" DEFAULT 'running' NOT NULL,
	"response_mode" "mock_response_mode" DEFAULT 'static' NOT NULL,
	"validate_requests" boolean DEFAULT true NOT NULL,
	"cors" boolean DEFAULT true NOT NULL,
	"source_type" "mock_source_type" NOT NULL,
	"source_url" text,
	"live_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"personal_owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_usage_hourly" ADD CONSTRAINT "mock_usage_hourly_mock_id_mocks_id_fk" FOREIGN KEY ("mock_id") REFERENCES "public"."mocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_versions" ADD CONSTRAINT "mock_versions_mock_id_mocks_id_fk" FOREIGN KEY ("mock_id") REFERENCES "public"."mocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_versions" ADD CONSTRAINT "mock_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mocks" ADD CONSTRAINT "mocks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mocks" ADD CONSTRAINT "mocks_live_version_id_mock_versions_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "public"."mock_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mocks" ADD CONSTRAINT "mocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mocks" ADD CONSTRAINT "mocks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_personal_owner_id_users_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_versions_mock_number_idx" ON "mock_versions" USING btree ("mock_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "mocks_workspace_slug_idx" ON "mocks" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "mocks_workspace_updated_idx" ON "mocks" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_personal_owner_idx" ON "workspaces" USING btree ("personal_owner_id");