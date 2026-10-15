import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import {
  createPersonalAccessTokenMutation,
  listPersonalAccessTokensQueryKey,
} from "@/client/@tanstack/react-query.gen";
import { Button, CodeBlock, Notice, TextInput } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { canEditMocks } from "@/features/workspaces/permissions";
import { errorMessage } from "@/lib/api/errors";
import type { PersonalAccessTokenScope, TokenExpiryDays, Workspace } from "@/lib/api/types";
import { copyText } from "@/lib/clipboard";
import page from "@/styles/page.module.scss";
import styles from "./AccessTokensPage.module.scss";
import { EXPIRY_OPTIONS, SCOPE_LABELS } from "./token-options";

const SCOPES: readonly PersonalAccessTokenScope[] = ["mocks:read", "mocks:write"];

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className={styles.field}>
      <div className={styles.snippetHead}>
        <span className={page.sectionTitle}>{label}</span>
        <Button
          size="sm"
          onClick={async () => {
            if (await copyText(text)) setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <CodeBlock>{text}</CodeBlock>
    </div>
  );
}

type CreateTokenModalProps = { workspace: Workspace; onClose: () => void };

export function CreateTokenModal({ workspace, onClose }: CreateTokenModalProps) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const scopeId = useId();
  const expiryId = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PersonalAccessTokenScope>("mocks:read");
  const [expiresInDays, setExpiresInDays] = useState<TokenExpiryDays>(30);
  const [error, setError] = useState<string | null>(null);

  const path = { ws: workspace.slug };
  const create = useMutation({
    ...createPersonalAccessTokenMutation(),
    // The result holds the plaintext token: drop it from the cache as soon as the modal lets go.
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listPersonalAccessTokensQueryKey({ path }) }),
    onError: (failure) => setError(errorMessage(failure)),
  });
  const created = create.data?.data;
  const canWrite = canEditMocks(workspace.role);

  function close() {
    create.reset();
    setName("");
    setError(null);
    void queryClient.invalidateQueries({ queryKey: listPersonalAccessTokensQueryKey({ path }) });
    onClose();
  }

  if (created) {
    const authorization = `Bearer ${created.plaintextToken}`;
    const config = { mcpServers: { mockyard: { type: "http", url: created.mcpUrl, headers: { Authorization: authorization } } } };
    return (
      <Modal
        title="Copy your token"
        width={560}
        onClose={close}
        actions={
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        }
      >
        <Notice kind="warning">Copy this token now. You won't be able to see it again.</Notice>
        <Snippet label="Token" text={created.plaintextToken} />
        <Snippet
          label="Claude Code"
          text={`claude mcp add --transport http mockyard ${created.mcpUrl} --header "Authorization: ${authorization}"`}
        />
        <Snippet label="MCP client config" text={JSON.stringify(config, null, 2)} />
      </Modal>
    );
  }

  const trimmed = name.trim();
  return (
    <Modal
      title="New access token"
      width={500}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={trimmed === "" || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({ path, body: { name: trimmed, scope, expiresInDays } });
            }}
          >
            {create.isPending ? "Creating…" : "Create token"}
          </Button>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      <div className={styles.field}>
        <label className={page.sectionTitle} htmlFor={nameId}>
          Name
        </label>
        <TextInput
          id={nameId}
          value={name}
          maxLength={100}
          placeholder="Claude Code"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
      <div className={styles.field}>
        <label className={page.sectionTitle} htmlFor={scopeId}>
          Access
        </label>
        <span className={styles.selectWrap}>
          <select
            id={scopeId}
            className={styles.select}
            value={scope}
            onChange={(event) => {
              const next = SCOPES.find((option) => option === event.target.value);
              if (next) setScope(next);
            }}
          >
            {SCOPES.map((option) => (
              <option key={option} value={option} disabled={option === "mocks:write" && !canWrite}>
                {SCOPE_LABELS[option]}
              </option>
            ))}
          </select>
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        </span>
        {!canWrite && <span className={page.hint}>Viewers can only create read-only tokens.</span>}
      </div>
      <div className={styles.field}>
        <label className={page.sectionTitle} htmlFor={expiryId}>
          Expires
        </label>
        <span className={styles.selectWrap}>
          <select
            id={expiryId}
            className={styles.select}
            value={expiresInDays}
            onChange={(event) => {
              const next = EXPIRY_OPTIONS.find((days) => String(days) === event.target.value);
              if (next) setExpiresInDays(next);
            }}
          >
            {EXPIRY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        </span>
      </div>
    </Modal>
  );
}
