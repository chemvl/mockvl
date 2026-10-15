import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { deleteWorkspaceMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice, TextInput } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useExitWorkspace } from "@/features/workspaces/use-exit-workspace";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace } from "@/lib/api/types";
import { plural } from "@/lib/format";
import { workspaceUrlPrefix } from "@/lib/mock-url";
import page from "@/styles/page.module.scss";

type DeleteWorkspaceModalProps = { workspace: Workspace; onClose: () => void };

export function DeleteWorkspaceModal({ workspace, onClose }: DeleteWorkspaceModalProps) {
  const exitWorkspace = useExitWorkspace();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    ...deleteWorkspaceMutation(),
    // Returning the promise keeps the button in "Deleting…" until we've navigated away.
    onSuccess: () => exitWorkspace(workspace, `${workspace.name} deleted`),
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={`Delete ${workspace.name}?`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={typed !== workspace.slug || remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate({ path: { ws: workspace.slug }, body: { confirmSlug: typed } });
            }}
          >
            {remove.isPending ? "Deleting…" : "Delete workspace"}
          </Button>
        </>
      }
    >
      <p className={`${page.bodyText} ${page.mono}`} style={{ wordBreak: "break-all" }}>
        {`${workspaceUrlPrefix()}${workspace.slug}`}
      </p>
      <p className={page.bodyText}>
        All {plural(workspace.mockCount, "mock")} stop responding and members lose access. Type {workspace.slug} to
        confirm.
      </p>
      <TextInput
        value={typed}
        placeholder={workspace.slug}
        aria-label="Type the prefix to confirm"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        onChange={(event) => setTyped(event.target.value)}
        style={{ width: "100%", fontFamily: "var(--font-mono)" }}
      />
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
