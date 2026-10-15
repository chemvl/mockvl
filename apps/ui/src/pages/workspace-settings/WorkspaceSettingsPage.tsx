import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { listWorkspaceMembersOptions, updateWorkspaceMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Checkbox, Notice, TextInput } from "@/components/ds";
import { SlugAvailability } from "@/components/SlugInput/SlugAvailability";
import { SlugInput } from "@/components/SlugInput/SlugInput";
import { useToast } from "@/components/Toast/toast-context";
import { slugCheckBlocks } from "@/features/mocks/use-slug-availability";
import { LeaveWorkspaceModal } from "@/features/workspaces/LeaveWorkspaceModal";
import { canManageWorkspace } from "@/features/workspaces/permissions";
import { useWorkspaceSlugAvailability } from "@/features/workspaces/use-workspace-slug-availability";
import { applyWorkspace } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace } from "@/lib/api/types";
import { plural } from "@/lib/format";
import { workspaceUrlPrefix } from "@/lib/mock-url";
import { WORKSPACE_SLUG_MAX_LENGTH } from "@/lib/workspace-slug";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import { ChangePrefixModal } from "./ChangePrefixModal";
import { DeleteWorkspaceModal } from "./DeleteWorkspaceModal";
import { TransferOwnershipModal } from "./TransferOwnershipModal";
import styles from "./WorkspaceSettingsPage.module.scss";

type Toggles = { domainJoinEnabled?: boolean; defaultValidate?: boolean; defaultCors?: boolean };
type Dialog = { kind: "prefix"; slug: string } | { kind: "transfer" } | { kind: "delete" } | { kind: "leave" };

/** Local edit state that starts over whenever the saved (server) value changes. */
function useSavedValue<T>(saved: T): [T, (value: T) => void] {
  const [value, setValue] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (lastSaved !== saved) {
    setLastSaved(saved);
    setValue(saved);
  }
  return [value, setValue];
}

function SettingsForm({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const path = { ws: workspace.slug };
  const isOwner = workspace.role === "owner";

  const [name, setName] = useSavedValue(workspace.name);
  const [slug, setSlug] = useSavedValue(workspace.slug);
  const [domainJoinEnabled, setDomainJoinEnabled] = useSavedValue(workspace.domainJoinEnabled);
  const [defaultValidate, setDefaultValidate] = useSavedValue(workspace.defaultValidate);
  const [defaultCors, setDefaultCors] = useSavedValue(workspace.defaultCors);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const slugCheck = useWorkspaceSlugAvailability(slug, workspace.slug);
  const members = useQuery({ ...listWorkspaceMembersOptions({ path }), enabled: isOwner });
  const admins = members.data?.data.filter((member) => member.role === "admin") ?? [];

  const rename = useMutation({
    ...updateWorkspaceMutation(),
    onSuccess: (result) => {
      applyWorkspace(queryClient, result.data);
      toast("Name saved");
    },
    onError: (failure) => {
      setName(workspace.name);
      setError(errorMessage(failure));
    },
  });

  const toggle = useMutation({
    ...updateWorkspaceMutation(),
    onSuccess: (result, variables) => {
      applyWorkspace(queryClient, result.data);
      toast(variables.body.domainJoinEnabled === undefined ? "Defaults saved" : "Join rule saved");
    },
    onError: (failure, variables) => {
      const body: Toggles = variables.body;
      if (body.domainJoinEnabled !== undefined) setDomainJoinEnabled(workspace.domainJoinEnabled);
      if (body.defaultValidate !== undefined) setDefaultValidate(workspace.defaultValidate);
      if (body.defaultCors !== undefined) setDefaultCors(workspace.defaultCors);
      setError(errorMessage(failure));
    },
  });

  function saveName() {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === workspace.name) {
      setName(workspace.name);
      return;
    }
    setName(trimmed);
    if (rename.isPending && rename.variables.body.name === trimmed) return;
    setError(null);
    rename.mutate({ path, body: { name: trimmed } });
  }

  function save(body: Toggles) {
    setError(null);
    toggle.mutate({ path, body });
  }

  const canChangePrefix = slug !== workspace.slug && slugCheck.state === "available";
  const closeDialog = () => setDialog(null);

  return (
    <div className={styles.settings}>
      <h1 className={page.title}>Workspace settings</h1>

      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <section className={styles.section}>
        <label className={page.sectionTitle} htmlFor="workspace-name">
          Name
        </label>
        <TextInput
          id="workspace-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          style={{ width: "100%" }}
        />
      </section>

      <section className={styles.section}>
        <span className={page.sectionTitle}>URL prefix</span>
        <div className={styles.slugRow}>
          <SlugInput
            prefix={workspaceUrlPrefix()}
            value={slug}
            invalid={slugCheckBlocks(slugCheck)}
            maxLength={WORKSPACE_SLUG_MAX_LENGTH}
            ariaLabel="URL prefix"
            onChange={setSlug}
          />
          <Button disabled={!canChangePrefix} onClick={() => setDialog({ kind: "prefix", slug })}>
            Save
          </Button>
        </div>
        <SlugAvailability kind="workspace" check={slugCheck} />
        <span className={page.hint}>
          Changing the prefix changes the URL of all {plural(workspace.mockCount, "mock")} in this workspace.
        </span>
      </section>

      {workspace.domainJoinAvailable && (
        <section className={styles.section}>
          <span className={page.sectionTitle}>Who can join</span>
          <Checkbox
            checked={domainJoinEnabled}
            disabled={toggle.isPending}
            onChange={(event) => {
              setDomainJoinEnabled(event.target.checked);
              save({ domainJoinEnabled: event.target.checked });
            }}
            label={`Anyone with an @${workspace.domain} Google account can join as Viewer without an invite`}
          />
        </section>
      )}

      <section className={styles.section}>
        <span className={page.sectionTitle}>Defaults for new mocks</span>
        <Checkbox
          checked={defaultValidate}
          disabled={toggle.isPending}
          onChange={(event) => {
            setDefaultValidate(event.target.checked);
            save({ defaultValidate: event.target.checked });
          }}
          label="Validate requests (422 on mismatch)"
        />
        <Checkbox
          checked={defaultCors}
          disabled={toggle.isPending}
          onChange={(event) => {
            setDefaultCors(event.target.checked);
            save({ defaultCors: event.target.checked });
          }}
          label="Allow cross-origin requests (CORS)"
        />
      </section>

      {isOwner ? (
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={page.sectionTitle}>Transfer ownership</span>
              <span className={page.hint}>
                {members.isSuccess && admins.length === 0
                  ? "Make someone an Admin first."
                  : "Make another Admin the owner. You become an Admin."}
              </span>
            </div>
            {admins.length > 0 && <Button onClick={() => setDialog({ kind: "transfer" })}>Transfer</Button>}
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={page.sectionTitle}>Delete workspace</span>
              <span className={page.hint}>
                All {plural(workspace.mockCount, "mock")} stop responding and members lose access.
              </span>
            </div>
            <Button style={{ color: "var(--error-text)" }} onClick={() => setDialog({ kind: "delete" })}>
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={page.sectionTitle}>Leave workspace</span>
              <span className={page.hint}>You lose access to its mocks. Mocks you created stay.</span>
            </div>
            <Button onClick={() => setDialog({ kind: "leave" })}>Leave</Button>
          </div>
        </div>
      )}

      {dialog?.kind === "prefix" && <ChangePrefixModal workspace={workspace} slug={dialog.slug} onClose={closeDialog} />}
      {dialog?.kind === "transfer" && (
        <TransferOwnershipModal workspace={workspace} admins={admins} onClose={closeDialog} />
      )}
      {dialog?.kind === "delete" && <DeleteWorkspaceModal workspace={workspace} onClose={closeDialog} />}
      {dialog?.kind === "leave" && <LeaveWorkspaceModal workspace={workspace} onClose={closeDialog} />}
    </div>
  );
}

export function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  if (!canManageWorkspace(workspace.role)) return <Navigate to={`/${workspace.slug}`} replace />;
  return <SettingsForm workspace={workspace} />;
}
