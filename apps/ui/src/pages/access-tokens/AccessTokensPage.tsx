import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { listPersonalAccessTokensOptions } from "@/client/@tanstack/react-query.gen";
import { type DataColumn, DataTable } from "@/components/DataTable/DataTable";
import { Button } from "@/components/ds";
import { PlaceholderRows } from "@/components/Placeholder/PlaceholderRows";
import { ErrorState } from "@/components/QueryState/QueryState";
import type { PersonalAccessToken } from "@/lib/api/types";
import { formatRelativeTime, formatTokenExpiry, plural } from "@/lib/format";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import styles from "./AccessTokensPage.module.scss";
import { CreateTokenModal } from "./CreateTokenModal";
import { RevokeTokenModal } from "./RevokeTokenModal";
import { SCOPE_LABELS } from "./token-options";

export function AccessTokensPage() {
  const workspace = useWorkspace();
  const tokens = useQuery(listPersonalAccessTokensOptions({ path: { ws: workspace.slug } }));
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PersonalAccessToken | null>(null);

  const columns: DataColumn<PersonalAccessToken>[] = [
    {
      key: "name",
      header: "Name",
      width: "minmax(0,1fr)",
      render: (token) => <span className={page.cellPrimary}>{token.name}</span>,
    },
    {
      key: "access",
      header: "Access",
      width: "120px",
      render: (token) => <span className={page.cellText}>{SCOPE_LABELS[token.scope]}</span>,
    },
    {
      key: "token",
      header: "Token",
      width: "150px",
      hideNarrow: true,
      render: (token) => <span className={`${page.cellSmall} ${page.mono}`}>{token.tokenHint}</span>,
    },
    {
      key: "lastUsed",
      header: "Last used",
      width: "110px",
      hideNarrow: true,
      render: (token) => (
        <span className={page.cellSmall}>{token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : "Never"}</span>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      width: "110px",
      render: (token) => {
        const expiry = formatTokenExpiry(token.expiresAt);
        return <span className={expiry === "Expired" ? styles.expired : page.cellSmall}>{expiry}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      align: "end",
      render: (token) => (
        <Button variant="text" onClick={() => setRevoking(token)}>
          Revoke
        </Button>
      ),
    },
  ];

  let table: ReactNode;
  if (tokens.isError) table = <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />;
  else if (tokens.isPending) table = <PlaceholderRows count={3} />;
  else if (tokens.data.data.length === 0) table = <p className={page.emptyLine}>No tokens yet.</p>;
  else table = <DataTable columns={columns} rows={tokens.data.data} rowKey={(token) => token.id} />;

  return (
    <div className={page.page}>
      <div className={page.titleRow}>
        <div className={page.titleBlock}>
          <h1 className={page.title}>Access tokens</h1>
          {tokens.isSuccess && <span className={page.meta}>{plural(tokens.data.data.length, "token")}</span>}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New token
        </Button>
      </div>
      <p className={`${page.intro} ${styles.intro}`}>
        Tokens let AI agents call this workspace's MCP server to read mocks and change their responses. A token only
        works in this workspace.
      </p>
      {table}

      {creating && <CreateTokenModal workspace={workspace} onClose={() => setCreating(false)} />}
      {revoking && <RevokeTokenModal workspace={workspace} token={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}
