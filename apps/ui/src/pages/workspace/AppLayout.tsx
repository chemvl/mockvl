import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { getMeOptions, listWorkspacesOptions } from "@/client/@tanstack/react-query.gen";
import { AppHeader } from "@/components/AppHeader/AppHeader";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { forgetOtherWorkspaces } from "@/lib/api/cache";
import styles from "./AppLayout.module.scss";
import { WorkspaceNotFound } from "./NotFound";
import type { WorkspaceOutletContext } from "./workspace-context";

export function AppLayout() {
  const { ws = "" } = useParams();
  const workspaces = useQuery(listWorkspacesOptions());
  const me = useQuery(getMeOptions());
  const list = workspaces.data?.data ?? [];
  const workspace = list.find((item) => item.slug === ws) ?? null;
  const queryClient = useQueryClient();
  const currentSlug = workspace?.slug;

  useEffect(() => {
    if (currentSlug) forgetOtherWorkspaces(queryClient, currentSlug);
  }, [queryClient, currentSlug]);

  let body: ReactNode;
  if (workspaces.isPending) body = <LoadingState label="Loading workspace…" />;
  else if (workspaces.isError) body = <ErrorState error={workspaces.error} onRetry={() => void workspaces.refetch()} />;
  else if (!workspace) body = <WorkspaceNotFound workspaces={list} />;
  else body = <Outlet context={{ workspace } satisfies WorkspaceOutletContext} />;

  return (
    <div className={styles.app}>
      <AppHeader
        workspaces={list}
        current={workspace}
        status={workspaces.status}
        onRetry={() => void workspaces.refetch()}
        email={me.data?.data.email ?? null}
      />
      <main className={styles.main}>{body}</main>
    </div>
  );
}
