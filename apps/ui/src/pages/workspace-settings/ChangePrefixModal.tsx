import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { listWorkspacesOptions, updateWorkspaceMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { applyWorkspace, forgetWorkspace } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { Workspace } from "@/lib/api/types";
import { workspaceUrlPrefix } from "@/lib/mock-url";
import page from "@/styles/page.module.scss";

type ChangePrefixModalProps = { workspace: Workspace; slug: string; onClose: () => void };

export function ChangePrefixModal({ workspace, slug, onClose }: ChangePrefixModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const prefix = workspaceUrlPrefix();

  const change = useMutation({
    ...updateWorkspaceMutation(),
    // Returning the promise keeps the button in "Changing…" until we've navigated.
    onSuccess: async (result) => {
      const updated = result.data;
      forgetWorkspace(queryClient, workspace.slug);
      // The list must hold the new slug before we route to it, or AppLayout shows "Workspace not found".
      await queryClient
        .fetchQuery({ ...listWorkspacesOptions(), staleTime: 0 })
        .catch(() => applyWorkspace(queryClient, updated));
      navigate(`/${updated.slug}/settings`, { replace: true });
      onClose();
      toast("URL prefix changed");
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title="Change URL prefix?"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={change.isPending}
            onClick={() => {
              setError(null);
              change.mutate({ path: { ws: workspace.slug }, body: { slug } });
            }}
          >
            {change.isPending ? "Changing…" : "Change prefix"}
          </Button>
        </>
      }
    >
      <p className={`${page.bodyText} ${page.mono}`} style={{ wordBreak: "break-all" }}>
        {`${prefix}${workspace.slug} → ${prefix}${slug}`}
      </p>
      <p className={page.bodyText}>Old URLs stop working right away.</p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
