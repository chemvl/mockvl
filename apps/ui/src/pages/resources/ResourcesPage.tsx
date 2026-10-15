import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { listMocksOptions } from "@/client/@tanstack/react-query.gen";
import { type DataColumn, DataTable } from "@/components/DataTable/DataTable";
import { Button, type TabItem, Tabs, TextInput } from "@/components/ds";
import { MockStatus } from "@/components/MockStatus/MockStatus";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { canEditMocks } from "@/features/workspaces/permissions";
import type { ListMocksQuery, MockListItem } from "@/lib/api/types";
import { formatCount, formatRelativeTime, formatUser, plural } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import styles from "./ResourcesPage.module.scss";

type Filter = "all" | "running" | "paused" | "mine";

const FILTERS: ReadonlyArray<TabItem<Filter>> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "mine", label: "Created by me" },
];

// A workspace holds at most 50 mocks, so one 100-row page is the whole list.
function listQuery(q: string, filter: Filter): ListMocksQuery {
  const query: Record<string, string> = { page: "1", pageSize: "100", sort: "updatedAt:desc" };
  if (q) query.q = q;
  if (filter === "running" || filter === "paused") query["filter[status][eq]"] = filter;
  if (filter === "mine") query["filter[createdBy][eq]"] = "me";
  return query;
}

function noResultsText(q: string, filter: Filter): string {
  if (q) return `No resources match “${q}”`;
  if (filter === "running") return "No running mocks.";
  if (filter === "paused") return "No paused mocks.";
  return "You haven't created any mocks yet.";
}

const COLUMNS: DataColumn<MockListItem>[] = [
  {
    key: "name",
    header: "Name",
    width: "minmax(0,2.4fr)",
    render: (mock) => (
      <div className={page.cellStack}>
        <span className={page.cellPrimary}>{mock.name}</span>
        <span className={page.cellUrl}>{mock.url}</span>
      </div>
    ),
  },
  {
    key: "endpoints",
    header: "Endpoints",
    width: "96px",
    render: (mock) => <span className={page.cellText}>{formatCount(mock.endpointCount)}</span>,
  },
  {
    key: "requests",
    header: "Requests 24h",
    width: "110px",
    render: (mock) => <span className={page.cellText}>{formatCount(mock.requests24h)}</span>,
  },
  {
    key: "updated",
    header: "Updated",
    width: "140px",
    hideNarrow: true,
    render: (mock) => (
      <div className={page.cellStack}>
        <span className={page.cellSmall}>{formatRelativeTime(mock.updatedAt)}</span>
        <span className={page.cellMuted}>{formatUser(mock.updatedBy)}</span>
      </div>
    ),
  },
  { key: "status", header: "Status", width: "100px", render: (mock) => <MockStatus status={mock.status} /> },
];

export function ResourcesPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const q = useDebouncedValue(search.trim(), 300);
  const path = { ws: workspace.slug };

  // Unfiltered list → title meta + empty-workspace decision. With no search/filter
  // the second query has the same key, so it is one request.
  const summary = useQuery(listMocksOptions({ path, query: listQuery("", "all") }));
  const list = useQuery({ ...listMocksOptions({ path, query: listQuery(q, filter) }), placeholderData: keepPreviousData });

  const canEdit = canEditMocks(workspace.role);
  const newMock = () => navigate(`/${workspace.slug}/new`);
  const total = summary.data?.meta.total ?? 0;
  const running = summary.data?.data.filter((mock) => mock.status === "running").length ?? 0;

  let content: ReactNode;
  if (summary.isPending) {
    content = <LoadingState label="Loading mocks…" />;
  } else if (summary.isError) {
    content = <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  } else if (total === 0) {
    content = (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>No mocks yet</h2>
        <p className={page.bodyText}>Import an OpenAPI or Postman schema and you get a live URL that answers with its examples.</p>
        {canEdit && (
          <Button variant="primary" onClick={newMock}>
            Create your first mock
          </Button>
        )}
      </div>
    );
  } else {
    let table: ReactNode;
    if (list.isPending) table = <LoadingState label="Loading mocks…" />;
    else if (list.isError) table = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
    else if (list.data.data.length === 0) table = <p className={page.emptyLine}>{noResultsText(q, filter)}</p>;
    else
      table = (
        <DataTable
          columns={COLUMNS}
          rows={list.data.data}
          rowKey={(mock) => mock.id}
          onRowClick={(mock) => navigate(`/${workspace.slug}/${mock.slug}`)}
        />
      );
    content = (
      <>
        <div className={styles.toolbar}>
          <TextInput
            className={styles.search}
            placeholder="Search by name or slug"
            aria-label="Search mocks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Tabs items={FILTERS} value={filter} onChange={setFilter} size="sm" />
        </div>
        {table}
      </>
    );
  }

  return (
    <div className={page.page}>
      <div className={page.titleRow}>
        <div className={page.titleBlock}>
          <h1 className={page.title}>Resources</h1>
          {summary.isSuccess && (
            <span className={page.meta}>
              {plural(total, "mock")} in {workspace.name} · {formatCount(running)} running
            </span>
          )}
        </div>
        {canEdit && total > 0 && (
          <Button variant="primary" onClick={newMock}>
            New mock
          </Button>
        )}
      </div>
      {content}
    </div>
  );
}
