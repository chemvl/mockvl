import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { getWorkspaceUsageOptions } from "@/client/@tanstack/react-query.gen";
import { type DataColumn, DataTable } from "@/components/DataTable/DataTable";
import { type TabItem, Tabs } from "@/components/ds";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import type { UsageReport } from "@/lib/api/types";
import { formatCount, plural } from "@/lib/format";
import { mockUrl } from "@/lib/mock-url";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";

type Range = "7d" | "30d";
type UsageRow = UsageReport["mocks"][number];

const RANGES: ReadonlyArray<TabItem<Range>> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function UsagePage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("7d");
  const usage = useQuery({
    ...getWorkspaceUsageOptions({ path: { ws: workspace.slug }, query: { range } }),
    placeholderData: keepPreviousData,
  });

  const columns: DataColumn<UsageRow>[] = [
    {
      key: "mock",
      header: "Mock",
      width: "minmax(0,2.4fr)",
      render: (row) => (
        <div className={page.cellStack}>
          <span className={page.cellPrimary}>{row.name}</span>
          <span className={page.cellUrl}>{mockUrl(workspace.slug, row.slug)}</span>
        </div>
      ),
    },
    { key: "requests", header: "Requests", width: "110px", render: (row) => <span className={page.cellText}>{formatCount(row.requests)}</span> },
    { key: "4xx", header: "4xx", width: "96px", render: (row) => <span className={page.cellText}>{formatCount(row.clientErrors)}</span> },
    { key: "5xx", header: "5xx", width: "96px", render: (row) => <span className={page.cellText}>{formatCount(row.serverErrors)}</span> },
  ];

  const days = range === "7d" ? "7 days" : "30 days";
  let meta: string | null = null;
  let body: ReactNode;
  if (usage.isPending) {
    body = <LoadingState label="Loading usage…" />;
  } else if (usage.isError) {
    body = <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />;
  } else {
    const report = usage.data.data;
    const errors = report.totals.clientErrors + report.totals.serverErrors;
    meta = `${plural(report.totals.requests, "request")} in the last ${days} · ${plural(errors, "error")}`;
    body =
      report.totals.requests === 0 ? (
        <p className={page.emptyLine}>No requests yet. Call a mock's base URL and usage appears here.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={report.mocks}
          rowKey={(row) => row.slug}
          onRowClick={(row) => navigate(`/${workspace.slug}/${row.slug}`)}
        />
      );
  }

  return (
    <div className={page.page}>
      <div className={page.titleBlock}>
        <h1 className={page.title}>Usage</h1>
        {meta && <span className={page.meta}>{meta}</span>}
      </div>
      <Tabs items={RANGES} value={range} onChange={setRange} size="sm" />
      {body}
    </div>
  );
}
