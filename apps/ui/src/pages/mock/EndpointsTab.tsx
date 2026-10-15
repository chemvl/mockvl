import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { listMockOperationsOptions } from "@/client/@tanstack/react-query.gen";
import { Badge, Button, CodeBlock } from "@/components/ds";
import { MethodPill } from "@/components/MethodPill/MethodPill";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { useToast } from "@/components/Toast/toast-context";
import { canEditMocks } from "@/features/workspaces/permissions";
import type { OperationSummary } from "@/lib/api/types";
import { copyText } from "@/lib/clipboard";
import { buildCurl, exampleUrl, preferValues } from "@/lib/curl";
import page from "@/styles/page.module.scss";
import { DeleteEndpointModal } from "./DeleteEndpointModal";
import styles from "./EndpointsTab.module.scss";
import { type MockLocationState, useMockContext } from "./mock-context";
import { RequestPreview } from "./RequestPreview";

export function EndpointsTab() {
  const { workspace, mock } = useMockContext();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [openKey, setOpenKey] = useState<string | null>(
    () => (location.state as MockLocationState | null)?.openKey ?? null,
  );
  const [deleting, setDeleting] = useState<OperationSummary | null>(null);
  const custom = mock.sourceType === "custom";
  const canEdit = canEditMocks(workspace.role);
  const base = `/${workspace.slug}/${mock.slug}`;
  const editUrl = (op: OperationSummary) =>
    `${base}/endpoints/edit?${new URLSearchParams({ method: op.method, path: op.path })}`;
  const addButton =
    custom && canEdit ? (
      <Button variant="primary" size="sm" onClick={() => navigate(`${base}/endpoints/new`)}>
        Add endpoint
      </Button>
    ) : null;
  // Fetched once a row is opened; one call covers every endpoint.
  const requests = useQuery({
    ...listMockOperationsOptions({ path: { ws: workspace.slug, slug: mock.slug } }),
    enabled: openKey !== null,
  });

  if (mock.operations.length === 0) {
    if (!custom) return <p className={page.emptyLine}>This schema has no endpoints.</p>;
    return (
      <div className={styles.empty}>
        <p className={page.emptyLine}>No endpoints yet. Add one to start serving responses.</p>
        {addButton}
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {addButton && <div className={styles.toolbar}>{addButton}</div>}
      <div className={styles.list}>
      {mock.operations.map((op) => {
        const key = `${op.method} ${op.path}`;
        const open = openKey === key;
        const curl = buildCurl(mock.url, op);
        const url = exampleUrl(mock.url, op.path);
        const toggle = () => setOpenKey(open ? null : key);
        const request = open
          ? requests.data?.data.find((item) => item.method === op.method && item.path === op.path)
          : undefined;
        return (
          <div key={key} className={styles.item}>
            <div
              className={styles.row}
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={toggle}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }}
            >
              <MethodPill method={op.method} />
              <span className={styles.path}>{op.path}</span>
              <span className={styles.summary}>{op.summary ?? ""}</span>
              <span className={styles.codes}>{op.codes.join(" · ")}</span>
            </div>
            {open && (
              <div className={styles.panel}>
                <div className={styles.snippet}>
                  <CodeBlock>{curl}</CodeBlock>
                  <div className={styles.prefer}>
                    <span className={page.label}>Prefer</span>
                    <div className={styles.badges}>
                      {preferValues(op).map((value) => (
                        <Badge key={value} variant="meta" style={{ fontFamily: "var(--font-mono)" }}>
                          {value}
                        </Badge>
                      ))}
                    </div>
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        onClick={async () => {
                          toast((await copyText(curl)) ? "Copied curl" : "Couldn't copy. Select the snippet and copy it.");
                        }}
                      >
                        Copy curl
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          toast((await copyText(url)) ? "Copied URL" : "Couldn't copy. Select the URL and copy it.");
                        }}
                      >
                        Copy URL
                      </Button>
                      {custom && canEdit && (
                        <>
                          <Button size="sm" onClick={() => navigate(editUrl(op))}>
                            Edit endpoint
                          </Button>
                          <Button size="sm" onClick={() => setDeleting(op)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {requests.isPending && <LoadingState label="Loading request inputs…" />}
                {requests.isError && <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />}
                {request && (
                  // Remount on a new live version so inputs re-derive from the new schema.
                  <RequestPreview
                    key={`${key} v${mock.liveVersion.number}`}
                    baseUrl={mock.url}
                    summary={op}
                    request={request}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
      {deleting && (
        <DeleteEndpointModal workspace={workspace} mock={mock} endpoint={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
