import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { deleteMockMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice, TextInput } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { forgetMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockDetail, Workspace } from "@/lib/api/types";
import { stripScheme } from "@/lib/format";
import page from "@/styles/page.module.scss";

type DeleteMockModalProps = { workspace: Workspace; mock: MockDetail; onClose: () => void };

export function DeleteMockModal({ workspace, mock, onClose }: DeleteMockModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    ...deleteMockMutation(),
    onSuccess: () => {
      navigate(`/${workspace.slug}`, { replace: true });
      forgetMock(queryClient, workspace.slug, mock.slug);
      toast(`Deleted ${mock.name}`);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const audience =
    workspace.memberCount === 1 ? "This can't be undone." : `This affects everyone in ${workspace.name}.`;

  return (
    <Modal
      title={`Delete ${mock.name}?`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={typed !== mock.slug || remove.isPending}
            onClick={() => remove.mutate({ path: { ws: workspace.slug, slug: mock.slug } })}
          >
            {remove.isPending ? "Deleting…" : "Delete mock"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>
        Requests to <span className={page.mono} style={{ wordBreak: "break-all" }}>{stripScheme(mock.url)}</span> will get
        404. {audience} Type the slug to confirm.
      </p>
      <TextInput
        value={typed}
        placeholder={mock.slug}
        aria-label="Type the slug to confirm"
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
