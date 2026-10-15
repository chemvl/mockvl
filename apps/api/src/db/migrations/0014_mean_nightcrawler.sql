ALTER TYPE "public"."mock_source_type" ADD VALUE 'custom';--> statement-breakpoint
ALTER TYPE "public"."mock_version_action" ADD VALUE 'edit';--> statement-breakpoint
ALTER TABLE "mock_versions" ADD COLUMN "custom_endpoints" jsonb;