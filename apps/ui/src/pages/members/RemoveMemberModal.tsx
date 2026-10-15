import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listWorkspaceMembersQueryKey,
  listWorkspacesQueryKey,
  removeWorkspaceMemberMutation,
} from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace, WorkspaceMember } from "@/lib/api/types";
import page from "@/styles/page.module.scss";

type RemoveMemberModalProps = { workspace: Workspace; member: WorkspaceMember; onClose: () => void };

export function RemoveMemberModal({ workspace, member, onClose }: RemoveMemberModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const displayName = member.name ?? member.email;

  const remove = useMutation({
    ...removeWorkspaceMemberMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listWorkspaceMembersQueryKey({ path: { ws: workspace.slug } }) });
      // memberCount changes.
      void queryClient.invalidateQueries({ queryKey: listWorkspacesQueryKey() });
      onClose();
      toast(`${displayName} removed`);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={`Remove ${displayName}?`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate({ path: { ws: workspace.slug, userId: member.userId } });
            }}
          >
            {remove.isPending ? "Removing…" : "Remove member"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>
        They lose access to all mocks in {workspace.name}. Mocks they created stay.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
