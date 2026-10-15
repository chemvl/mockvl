-- Deleting a user who owns a personal workspace and authored mocks in it runs
-- two ON DELETE SET NULL updates (created_by, updated_by) on the same mock
-- row. The second update re-checks workspace_id after the workspace cascade
-- already deleted the workspace, failing the delete. Deferring the check to
-- commit lets the cascade delete the mock row first; deleted rows are not
-- re-checked. drizzle-kit does not model DEFERRABLE, so this is hand-written.
ALTER TABLE "mocks" ALTER CONSTRAINT "mocks_workspace_id_workspaces_id_fk" DEFERRABLE INITIALLY DEFERRED;
