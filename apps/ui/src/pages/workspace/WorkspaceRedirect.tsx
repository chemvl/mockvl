import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { listWorkspacesOptions } from "@/client/@tanstack/react-query.gen";
import { Notice } from "@/components/ds";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import styles from "./NotFound.module.scss";

// "/" → first workspace (listWorkspaces creates the personal one if missing).
export function WorkspaceRedirect() {
  const workspaces = useQuery(listWorkspacesOptions());
  if (workspaces.isPending) {
    return (
      <div className={styles.center}>
        <LoadingState label="Loading workspaces…" />
      </div>
    );
  }
  if (workspaces.isError) {
    return (
      <div className={styles.center}>
        <ErrorState error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      </div>
    );
  }
  const first = workspaces.data.data[0];
  if (!first) {
    return (
      <div className={styles.center}>
        <Notice kind="error">No workspace is available for this account. Sign out and sign in again.</Notice>
      </div>
    );
  }
  return <Navigate to={`/${first.slug}`} replace />;
}
