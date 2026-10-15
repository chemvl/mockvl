import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { listMockVersionsOptions, restoreMockVersionMutation } from "@/client/@tanstack/react-query.gen";
import { type DataColumn, DataTable } from "@/components/DataTable/DataTable";
import { Badge, Button, Notice } from "@/components/ds";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { useToast } from "@/components/Toast/toast-context";
import { canEditMocks } from "@/features/workspaces/permissions";
import { applyMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockVersion } from "@/lib/api/types";
import { formatUser, formatVersionAction, formatVersionDate, formatVersionDiff, stripScheme } from "@/lib/format";
import page from "@/styles/page.module.scss";
import { useMockContext } from "./mock-context";
import styles from "./VersionsTab.module.scss";

export function VersionsTab() {
  const { workspace, mock } = useMockContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const path = { ws: workspace.slug, slug: mock.slug };
  const canEdit = canEditMocks(workspace.role);
  const versions = useQuery(listMockVersionsOptions({ path }));

  const restore = useMutation({
    ...restoreMockVersionMutation(),
    onSuccess: (result, variables) => {
      applyMock(queryClient, workspace.slug, result.data);
      toast(`Restored v${variables.path.number} → v${result.data.liveVersion.number}`);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const columns: DataColumn<MockVersion>[] = [
    { key: "number", header: "Version", width: "64px", render: (v) => <span className={styles.version}>v{v.number}</span> },
    {
      key: "action",
      header: "Action",
      width: "minmax(0,1.4fr)",
      render: (v) => (
        <div className={page.cellStack}>
          <span className={styles.action}>{formatVersionAction(v)}</span>
          <span className={page.cellUrl}>{stripScheme(v.sourceLabel)}</span>
        </div>
      ),
    },
    {
      key: "diff",
      header: "Changes",
      width: "minmax(0,1fr)",
      hideNarrow: true,
      render: (v) => <span className={styles.diff}>{formatVersionDiff(v)}</span>,
    },
    {
      key: "when",
      header: "Date",
      width: "160px",
      hideNarrow: true,
      render: (v) => (
        <div className={page.cellStack}>
          <span className={page.cellSmall}>{formatVersionDate(v.createdAt)}</span>
          <span className={page.cellMuted}>{formatUser(v.createdBy)}</span>
        </div>
      ),
    },
    {
      key: "live",
      header: "",
      width: "110px",
      align: "end",
      render: (v) =>
        v.live ? (
          <Badge variant="coral">Live</Badge>
        ) : canEdit ? (
          <Button
            size="sm"
            disabled={restore.isPending}
            onClick={() => {
              setError(null);
              restore.mutate({ path: { ...path, number: v.number } });
            }}
          >
            Restore
          </Button>
        ) : null,
    },
  ];

  let body: ReactNode;
  if (versions.isPending) body = <LoadingState label="Loading versions…" />;
  else if (versions.isError) body = <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />;
  else if (versions.data.data.length === 0) body = <p className={page.emptyLine}>No versions yet.</p>;
  else body = <DataTable columns={columns} rows={versions.data.data} rowKey={(v) => String(v.number)} showHeader={false} />;

  return (
    <>
      <p className={page.intro}>
        A new version is saved each time the schema is replaced or re-synced. Restoring makes a copy the live version.
      </p>
      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {body}
    </>
  );
}
