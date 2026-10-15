import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { getMockOptions } from "@/client/@tanstack/react-query.gen";
import { BaseUrlBar } from "@/components/BaseUrlBar/BaseUrlBar";
import { Notice, Tabs } from "@/components/ds";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { canEditMocks } from "@/features/workspaces/permissions";
import { ApiError } from "@/lib/api/errors";
import { NotFoundContent } from "@/pages/workspace/NotFound";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import type { MockLocationState, MockNotice, MockOutletContext } from "./mock-context";
import { MockHeader } from "./MockHeader";

type DetailTab = "endpoints" | "versions" | "settings";

function MockLayout({ slug }: { slug: string }) {
  const workspace = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<MockNotice | null>(() => {
    const state = location.state as MockLocationState | null;
    return state?.notice ? { kind: "info", text: state.notice } : null;
  });
  const query = useQuery(getMockOptions({ path: { ws: workspace.slug, slug } }));

  if (query.isPending) return <LoadingState label="Loading mock…" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundContent />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const mock = query.data.data;
  const base = `/${workspace.slug}/${mock.slug}`;
  const tab: DetailTab = location.pathname.endsWith("/versions")
    ? "versions"
    : location.pathname.endsWith("/settings")
      ? "settings"
      : "endpoints";

  return (
    <div className={page.page}>
      <MockHeader workspace={workspace} mock={mock} onNotice={setNotice} />
      <BaseUrlBar url={mock.url} />
      <Notice kind="info">Mock template for each schema is coming soon.</Notice>
      {notice && (
        <Notice
          kind={notice.kind}
          onDismiss={() => {
            setNotice(null);
            navigate(location.pathname, { replace: true, state: null });
          }}
        >
          {notice.text}
        </Notice>
      )}
      {mock.status === "paused" && (
        <Notice kind="warning">This mock is paused. Requests return 503 until you resume it.</Notice>
      )}
      <Tabs
        items={[
          { value: "endpoints", label: "Endpoints", count: mock.endpointCount },
          { value: "versions", label: "Versions", count: mock.versionCount },
          ...(canEditMocks(workspace.role) ? [{ value: "settings" as const, label: "Settings" }] : []),
        ]}
        value={tab}
        onChange={(next) => navigate(next === "endpoints" ? base : `${base}/${next}`)}
      />
      <Outlet context={{ workspace, mock } satisfies MockOutletContext} />
    </div>
  );
}

// Keyed by slug so per-mock state (notice, open rows) resets between mocks.
export function MockRoute() {
  const { slug = "" } = useParams();
  return <MockLayout key={slug} slug={slug} />;
}
