import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { getMockSchemaOptions, resyncMockMutation, updateMockMutation } from "@/client/@tanstack/react-query.gen";
import { Badge, Button } from "@/components/ds";
import { MockStatus } from "@/components/MockStatus/MockStatus";
import { useToast } from "@/components/Toast/toast-context";
import { canEditMocks } from "@/features/workspaces/permissions";
import { applyMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockDetail, Workspace } from "@/lib/api/types";
import { downloadText } from "@/lib/download";
import { formatMockMeta } from "@/lib/format";
import page from "@/styles/page.module.scss";
import type { MockNotice } from "./mock-context";
import styles from "./MockHeader.module.scss";
import { ReplaceSchemaModal } from "./ReplaceSchemaModal";

type MockHeaderProps = { workspace: Workspace; mock: MockDetail; onNotice: (notice: MockNotice | null) => void };

export function MockHeader({ workspace, mock, onNotice }: MockHeaderProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const path = { ws: workspace.slug, slug: mock.slug };

  const setStatus = useMutation({
    ...updateMockMutation(),
    onSuccess: (result) => {
      applyMock(queryClient, workspace.slug, result.data);
      toast(result.data.status === "paused" ? "Mock paused" : "Mock resumed");
    },
    onError: (failure) => onNotice({ kind: "error", text: errorMessage(failure) }),
  });

  const resync = useMutation({
    ...resyncMockMutation(),
    onSuccess: (result) => {
      const live = result.data.mock.liveVersion.number;
      applyMock(queryClient, workspace.slug, result.data.mock);
      if (result.data.changed) {
        onNotice(null);
        toast(`Re-synced → v${live}`);
      } else {
        onNotice({ kind: "info", text: `Schema unchanged since v${live}.` });
      }
    },
    onError: (failure) => onNotice({ kind: "error", text: errorMessage(failure) }),
  });

  const custom = mock.sourceType === "custom";
  const canEdit = canEditMocks(workspace.role);
  const schemaFile = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...getMockSchemaOptions({ path }), staleTime: 0 }),
    onSuccess: (result) => downloadText(result.data.filename, result.data.content),
    onError: (failure) => onNotice({ kind: "error", text: errorMessage(failure) }),
  });

  return (
    <div className={styles.head}>
      <Link to={`/${workspace.slug}`} className={page.crumb}>
        Resources /
      </Link>
      <div className={styles.row}>
        <div className={styles.titleBlock}>
          <h1 className={page.title}>{mock.name}</h1>
          <div className={styles.metaRow}>
            <MockStatus status={mock.status} />
            {custom && <Badge variant="meta">Custom</Badge>}
            <span className={styles.meta}>{formatMockMeta(mock)}</span>
          </div>
        </div>
        {(canEdit || custom) && (
          <div className={styles.actions}>
            {custom && (
              <Button disabled={schemaFile.isPending} onClick={() => schemaFile.mutate()}>
                {schemaFile.isPending ? "Generating…" : "Generate schema"}
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ path, body: { status: mock.status === "running" ? "paused" : "running" } })}
                >
                  {mock.status === "running" ? "Pause" : "Resume"}
                </Button>
                {mock.sourceType === "url" && (
                  <Button disabled={resync.isPending} onClick={() => resync.mutate({ path })}>
                    {resync.isPending ? "Syncing…" : "Re-sync"}
                  </Button>
                )}
                {!custom && <Button onClick={() => setReplaceOpen(true)}>Replace schema</Button>}
              </>
            )}
          </div>
        )}
      </div>
      {replaceOpen && (
        <ReplaceSchemaModal
          workspace={workspace}
          mock={mock}
          onClose={() => setReplaceOpen(false)}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
