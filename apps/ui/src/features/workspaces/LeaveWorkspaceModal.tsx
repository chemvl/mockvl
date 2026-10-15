import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { leaveWorkspaceMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace } from "@/lib/api/types";
import page from "@/styles/page.module.scss";
import { useExitWorkspace } from "./use-exit-workspace";

export function LeaveWorkspaceModal({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const exitWorkspace = useExitWorkspace();
  const [error, setError] = useState<string | null>(null);

  const leave = useMutation({
    ...leaveWorkspaceMutation(),
    // Returning the promise keeps the button in "Leaving…" until we've navigated away.
    onSuccess: () => exitWorkspace(workspace, `You left ${workspace.name}`),
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={`Leave ${workspace.name}?`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={leave.isPending}
            onClick={() => {
              setError(null);
              leave.mutate({ path: { ws: workspace.slug } });
            }}
          >
            {leave.isPending ? "Leaving…" : "Leave workspace"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>You lose access to its mocks. Mocks you created stay.</p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
