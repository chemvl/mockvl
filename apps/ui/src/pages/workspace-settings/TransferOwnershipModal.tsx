import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listWorkspaceMembersQueryKey, transferWorkspaceMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Checkbox, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { applyWorkspace } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace, WorkspaceMember } from "@/lib/api/types";
import styles from "./WorkspaceSettingsPage.module.scss";

type TransferOwnershipModalProps = { workspace: Workspace; admins: WorkspaceMember[]; onClose: () => void };

export function TransferOwnershipModal({ workspace, admins, onClose }: TransferOwnershipModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<WorkspaceMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transfer = useMutation({
    ...transferWorkspaceMutation(),
    onSuccess: (result) => {
      // The result is our own view (now admin): the page re-renders with the Leave card.
      applyWorkspace(queryClient, result.data);
      void queryClient.invalidateQueries({ queryKey: listWorkspaceMembersQueryKey({ path: { ws: workspace.slug } }) });
      onClose();
      if (selected) toast(`${selected.name ?? selected.email} is now the owner`);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title="Transfer ownership"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selected || transfer.isPending}
            onClick={() => {
              if (!selected) return;
              setError(null);
              transfer.mutate({ path: { ws: workspace.slug }, body: { userId: selected.userId } });
            }}
          >
            {transfer.isPending ? "Transferring…" : "Transfer ownership"}
          </Button>
        </>
      }
    >
      <div className={styles.radioList} role="radiogroup" aria-label="New owner">
        {admins.map((admin) => (
          <Checkbox
            key={admin.userId}
            type="radio"
            name="transfer-owner"
            value={admin.userId}
            checked={selected?.userId === admin.userId}
            disabled={transfer.isPending}
            onChange={() => setSelected(admin)}
            label={
              <span className={styles.adminLabel}>
                <span className={styles.adminName}>{admin.name ?? admin.email}</span>
                {admin.name && <span className={styles.adminEmail}>{admin.email}</span>}
              </span>
            }
          />
        ))}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
