import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { createWorkspaceMutation, listWorkspacesQueryKey } from "@/client/@tanstack/react-query.gen";
import type { ListWorkspacesResponse } from "@/client/types.gen";
import { Button, Notice, TextInput } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { SlugAvailability } from "@/components/SlugInput/SlugAvailability";
import { SlugInput } from "@/components/SlugInput/SlugInput";
import { useToast } from "@/components/Toast/toast-context";
import { slugCheckBlocks } from "@/features/mocks/use-slug-availability";
import { errorMessage } from "@/lib/api/errors";
import { workspaceUrlPrefix } from "@/lib/mock-url";
import { slugifyWorkspaceName, WORKSPACE_SLUG_MAX_LENGTH } from "@/lib/workspace-slug";
import page from "@/styles/page.module.scss";
import styles from "./CreateWorkspaceModal.module.scss";
import { useWorkspaceSlugAvailability } from "./use-workspace-slug-availability";

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const nameId = useId();
  const slugId = useId();
  const [name, setName] = useState("");
  // null until the user edits the slug field; until then it follows the name.
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = editedSlug ?? slugifyWorkspaceName(name);
  const check = useWorkspaceSlugAvailability(slug);

  const create = useMutation({
    ...createWorkspaceMutation(),
    onSuccess: (result) => {
      const created = result.data;
      queryClient.setQueryData(listWorkspacesQueryKey(), (old: ListWorkspacesResponse | undefined) =>
        old ? { data: [created, ...old.data.filter((workspace) => workspace.id !== created.id)] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: listWorkspacesQueryKey() });
      onClose();
      navigate(`/${created.slug}`);
      toast("Workspace created");
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const trimmedName = name.trim();
  const canCreate = trimmedName !== "" && check.state === "available" && !create.isPending;

  function submit() {
    if (!canCreate) return;
    setError(null);
    create.mutate({ body: { name: trimmedName, slug } });
  }

  return (
    <Modal
      title="Create workspace"
      width={460}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canCreate} onClick={submit}>
            {create.isPending ? "Creating…" : "Create workspace"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>A workspace holds mocks for one team. You can invite people after it's created.</p>
      <div className={styles.field}>
        <label htmlFor={nameId} className={page.sectionTitle}>
          Name
        </label>
        <TextInput
          id={nameId}
          value={name}
          maxLength={60}
          autoFocus
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          style={{ width: "100%" }}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={slugId} className={page.sectionTitle}>
          URL prefix
        </label>
        <SlugInput
          id={slugId}
          prefix={workspaceUrlPrefix()}
          value={slug}
          maxLength={WORKSPACE_SLUG_MAX_LENGTH}
          ariaLabel="URL prefix"
          invalid={slugCheckBlocks(check)}
          onChange={setEditedSlug}
        />
        <SlugAvailability kind="workspace" check={check} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
