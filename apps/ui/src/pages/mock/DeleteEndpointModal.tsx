import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteCustomEndpointMutation, listMockOverridesOptions } from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { refreshCustomMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockDetail, OperationSummary, Workspace } from "@/lib/api/types";
import { plural } from "@/lib/format";
import page from "@/styles/page.module.scss";

type DeleteEndpointModalProps = {
  workspace: Workspace;
  mock: MockDetail;
  endpoint: OperationSummary;
  onClose: () => void;
};

export function DeleteEndpointModal({ workspace, mock, endpoint, onClose }: DeleteEndpointModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const mockPath = { ws: workspace.slug, slug: mock.slug };
  const overrides = useQuery(listMockOverridesOptions({ path: mockPath }));
  const edits =
    overrides.data?.data.filter((item) => item.method === endpoint.method && item.path === endpoint.path).length ?? 0;
  const label = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
  const remove = useMutation({
    ...deleteCustomEndpointMutation(),
    onSuccess: async () => {
      await refreshCustomMock(queryClient, workspace.slug, mock.slug);
      toast(`Deleted ${label}`);
      onClose();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={
        <>
          Delete <span className={page.mono}>{label}</span>?
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({
                path: mockPath,
                query: { method: endpoint.method, path: endpoint.path, baseVersion: mock.liveVersion.number },
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete endpoint"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>
        Mock requests to it will return 404.
        {edits > 0 &&
          ` Its ${plural(edits, "edited response")} ${edits === 1 ? "is" : "are"} kept but stop${edits === 1 ? "s" : ""} being served.`}
      </p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
