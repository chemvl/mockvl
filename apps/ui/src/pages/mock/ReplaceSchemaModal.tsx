import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { replaceMockSchemaMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { type FileState, pickSource, type SourceTab } from "@/components/SchemaSourcePicker/schema-source";
import { SchemaSourcePicker } from "@/components/SchemaSourcePicker/SchemaSourcePicker";
import { useToast } from "@/components/Toast/toast-context";
import { applyMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockDetail, Workspace } from "@/lib/api/types";
import page from "@/styles/page.module.scss";
import type { MockNotice } from "./mock-context";

type ReplaceSchemaModalProps = {
  workspace: Workspace;
  mock: MockDetail;
  onClose: () => void;
  onNotice: (notice: MockNotice | null) => void;
};

export function ReplaceSchemaModal({ workspace, mock, onClose, onNotice }: ReplaceSchemaModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<SourceTab>(mock.sourceType === "url" ? "url" : "file");
  const [file, setFile] = useState<FileState>({ status: "empty" });
  const [url, setUrl] = useState(mock.sourceUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  const replace = useMutation({
    ...replaceMockSchemaMutation(),
    onSuccess: (result) => {
      const before = mock.liveVersion.number;
      const after = result.data.liveVersion.number;
      applyMock(queryClient, workspace.slug, result.data);
      if (after === before) {
        onNotice({ kind: "info", text: `Schema unchanged since v${before}.` });
      } else {
        onNotice(null);
        toast(`Schema replaced → v${after}`);
      }
      onClose();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  function submit() {
    setError(null);
    const picked = pickSource(tab, file, url);
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    replace.mutate({ path: { ws: workspace.slug, slug: mock.slug }, body: { source: picked.source } });
  }

  const busy = replace.isPending || file.status === "parsing";

  return (
    <Modal
      title="Replace schema"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? "Parsing schema…" : "Replace schema"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>Every endpoint is rebuilt from the new schema. The current version stays in Versions.</p>
      <SchemaSourcePicker
        ws={workspace.slug}
        tab={tab}
        onTabChange={(next) => {
          if (next !== "blank") setTab(next);
        }}
        file={file}
        onFileChange={setFile}
        url={url}
        onUrlChange={setUrl}
        onError={setError}
      />
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
