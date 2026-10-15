import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { inspectSchemaMutation } from "@/client/@tanstack/react-query.gen";
import { DropZone, Tabs, TextInput } from "@/components/ds";
import { errorMessage } from "@/lib/api/errors";
import { formatSchemaMeta } from "@/lib/format";
import {
  BLANK_TAB,
  type FileState,
  MAX_SCHEMA_BYTES,
  type PickerTab,
  SOURCE_TABS,
} from "./schema-source";
import styles from "./SchemaSourcePicker.module.scss";

const ACCEPT = ".json,.yaml,.yml,application/json,application/yaml,text/yaml";

type SchemaSourcePickerProps = {
  ws: string;
  tab: PickerTab;
  onTabChange: (tab: PickerTab) => void;
  allowBlank?: boolean;
  file: FileState;
  onFileChange: (file: FileState) => void;
  url: string;
  onUrlChange: (url: string) => void;
  onError: (message: string | null) => void;
};

export function SchemaSourcePicker({
  ws,
  tab,
  onTabChange,
  allowBlank,
  file,
  onFileChange,
  url,
  onUrlChange,
  onError,
}: SchemaSourcePickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inspect = useMutation(inspectSchemaMutation());

  async function pick(selected: File) {
    onError(null);
    const filename = selected.name.slice(0, 200);
    if (selected.size > MAX_SCHEMA_BYTES) {
      onError(`${filename} is larger than 5 MB.`);
      return;
    }
    onFileChange({ status: "parsing", filename });
    const content = await selected.text();
    inspect.mutate(
      { path: { ws }, body: { source: { type: "file", filename, content } } },
      {
        onSuccess: (result) => onFileChange({ status: "ready", filename, content, inspection: result.data }),
        onError: (failure) => {
          onFileChange({ status: "empty" });
          onError(errorMessage(failure));
        },
      },
    );
  }

  return (
    <div className={styles.picker}>
      <Tabs
        items={allowBlank ? [...SOURCE_TABS, BLANK_TAB] : SOURCE_TABS}
        value={tab}
        onChange={(next) => {
          onError(null);
          onTabChange(next);
        }}
      />
      {tab === "file" ? (
        <>
          {file.status === "empty" ? (
            <>
              <input
                ref={fileInput}
                className={styles.hiddenInput}
                type="file"
                accept={ACCEPT}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = "";
                  if (selected) void pick(selected);
                }}
              />
              <DropZone
                title="Drop a schema file here"
                hint="or click to choose a file"
                active={dragging}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = event.dataTransfer.files.item(0);
                  if (dropped) void pick(dropped);
                }}
              />
            </>
          ) : (
            <div className={styles.fileRow}>
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{file.filename}</span>
                <span className={styles.fileMeta}>
                  {file.status === "ready" ? formatSchemaMeta(file.inspection) : "Parsing schema…"}
                </span>
              </div>
              {file.status === "ready" && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label="Remove file"
                  onClick={() => onFileChange({ status: "empty" })}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <span className={styles.hint}>OpenAPI 3.x or Postman collection · JSON or YAML · up to 5 MB</span>
        </>
      ) : tab === "url" ? (
        <>
          <TextInput
            type="url"
            value={url}
            placeholder="https://example.com/openapi.yaml"
            aria-label="Schema URL"
            spellCheck={false}
            onChange={(event) => onUrlChange(event.target.value)}
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 14 }}
          />
          <span className={styles.hint}>Must be publicly reachable.</span>
        </>
      ) : (
        <span className={styles.hint}>
          The mock starts with no endpoints. Add them on its Endpoints tab, each with its own responses.
        </span>
      )}
    </div>
  );
}
