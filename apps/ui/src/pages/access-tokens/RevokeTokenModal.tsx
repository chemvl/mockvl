import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listPersonalAccessTokensQueryKey,
  revokePersonalAccessTokenMutation,
} from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { errorMessage } from "@/lib/api/errors";
import type { PersonalAccessToken, Workspace } from "@/lib/api/types";
import page from "@/styles/page.module.scss";

type RevokeTokenModalProps = { workspace: Workspace; token: PersonalAccessToken; onClose: () => void };

export function RevokeTokenModal({ workspace, token, onClose }: RevokeTokenModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    ...revokePersonalAccessTokenMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: listPersonalAccessTokensQueryKey({ path: { ws: workspace.slug } }),
      });
      onClose();
      toast("Token revoked.");
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={`Revoke “${token.name}”?`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={revoke.isPending}
            onClick={() => {
              setError(null);
              revoke.mutate({ path: { ws: workspace.slug, id: token.id } });
            }}
          >
            {revoke.isPending ? "Revoking…" : "Revoke token"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>Agents using it lose access immediately.</p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
