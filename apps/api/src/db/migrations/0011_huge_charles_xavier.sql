-- Hand-edited after drizzle-kit generate:
-- - workspace_role is swapped in place so existing 'member' rows become
--   'editor'; drizzle's text round-trip would fail on 'member'.
-- - owner_id/domain are backfilled from the owner membership before NOT NULL.
-- - The deferred single-owner constraint triggers (appended last) are not
--   modeled by drizzle-kit. Code inserting a workspace must insert its owner
--   membership in the same transaction.
ALTER TYPE "workspace_role" RENAME TO "workspace_role_old";--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DATA TYPE "workspace_role" USING (CASE "role"::text WHEN 'member' THEN 'editor' ELSE "role"::text END)::"workspace_role";--> statement-breakpoint
DROP TYPE "workspace_role_old";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "domain" text;--> statement-breakpoint
UPDATE "workspaces" w SET "owner_id" = m."user_id", "domain" = lower(split_part(u."email", '@', 2))
  FROM "workspace_members" m JOIN "users" u ON u."id" = m."user_id"
  WHERE m."workspace_id" = w."id" AND m."role" = 'owner';--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "domain" SET NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."workspace_audit_action" AS ENUM('invite_sent', 'invite_resent', 'invite_revoked', 'member_role_changed', 'member_removed', 'slug_changed', 'ownership_transferred', 'workspace_deleted');--> statement-breakpoint
CREATE TABLE "workspace_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" "workspace_audit_action" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invites_role_check" CHECK ("workspace_invites"."role" <> 'owner')
);
--> statement-breakpoint
CREATE TABLE "workspace_member_exits" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_exits_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"old_slug" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "domain_join_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_validate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_cors" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_exits" ADD CONSTRAINT "workspace_member_exits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_exits" ADD CONSTRAINT "workspace_member_exits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_slug_history" ADD CONSTRAINT "workspace_slug_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_audit_events_workspace_created_idx" ON "workspace_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_token_hash_idx" ON "workspace_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_open_idx" ON "workspace_invites" USING btree ("workspace_id","email") WHERE "workspace_invites"."accepted_at" is null and "workspace_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "workspace_slug_history_old_slug_idx" ON "workspace_slug_history" USING btree ("old_slug");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_one_owner_idx" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_domain_join_idx" ON "workspaces" USING btree ("domain") WHERE "workspaces"."domain_join_enabled" and "workspaces"."deleted_at" is null;--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_workspace_single_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; expected uuid; owners int; owner_user uuid;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target := OLD.workspace_id;
  ELSE target := NEW.workspace_id; END IF;
  SELECT owner_id INTO expected FROM workspaces WHERE id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), min(user_id::text)::uuid INTO owners, owner_user
    FROM workspace_members WHERE workspace_id = target AND role = 'owner';
  IF owners <> 1 OR owner_user IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'workspace % must have exactly one owner matching owner_id', target USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_members_single_owner AFTER INSERT OR UPDATE OR DELETE ON workspace_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_single_owner();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspaces_single_owner AFTER INSERT OR UPDATE OF owner_id ON workspaces
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_single_owner();
