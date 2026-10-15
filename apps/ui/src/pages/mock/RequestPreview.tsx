import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import {
  listMockOverridesOptions,
  listMockOverridesQueryKey,
  saveMockOverrideMutation,
} from "@/client/@tanstack/react-query.gen";
import { Badge, Button, CodeBlock, Notice, TextInput } from "@/components/ds";
import { JsonViewer } from "@/components/JsonViewer/JsonViewer";
import { useToast } from "@/components/Toast/toast-context";
import { canEditMocks } from "@/features/workspaces/permissions";
import { errorMessage } from "@/lib/api/errors";
import type { OperationParameter, OperationRequest, OperationSummary } from "@/lib/api/types";
import { preferOptions, statusCodes } from "@/lib/curl";
import { buildPreviewUrl, type PreviewResult, type PreviewValues, sendPreview, sendsBody } from "@/lib/preview-request";
import {
  initialBodyText,
  initialParameterValue,
  isJsonMediaType,
  parameterPlaceholder,
  schemaType,
} from "@/lib/schema-sample";
import page from "@/styles/page.module.scss";
import { useMockContext } from "./mock-context";
import styles from "./RequestPreview.module.scss";
import { ResetOverrideModal } from "./ResetOverrideModal";

// CodeMirror downloads on the first Edit only.
const JsonEditor = lazy(() =>
  import("@/components/JsonEditor/JsonEditor").then((module) => ({ default: module.JsonEditor })),
);

type ParamGroup = "path" | "query" | "header";

const GROUP_TITLES: Record<ParamGroup, string> = { path: "Path", query: "Query", header: "Headers" };

type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "done"; result: PreviewResult }
  | { state: "failed"; message: string };

/** The response being edited. Save compares `text` against `initial`. */
type Editing = { initial: string; text: string; valid: boolean; error: string | null };

const NETWORK_FAILURE =
  "Couldn't reach the mock. Check your connection, or that the mock URL is reachable from this browser (CORS).";

function initialValues(request: OperationRequest): PreviewValues {
  const fill = (params: OperationParameter[]) =>
    Object.fromEntries(params.map((param) => [param.name, initialParameterValue(param)]));
  return {
    path: fill(request.parameters.path),
    query: fill(request.parameters.query),
    header: fill(request.parameters.header),
    code: "",
    prefer: "",
    body: request.body ? initialBodyText(request.body) : "",
  };
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function statusTone(status: number): string {
  if (status >= 500) return "var(--error)";
  if (status >= 400) return "var(--warning)";
  return "var(--success)";
}

function previewUrl(baseUrl: string, request: OperationRequest, values: PreviewValues): string {
  try {
    return buildPreviewUrl(baseUrl, request, values);
  } catch {
    return `${baseUrl}${request.path}`;
  }
}

/** What the editor opens with: the saved bytes when overridden, else pretty-printed JSON. */
function editorText(result: PreviewResult): string | null {
  if (result.body.kind !== "json") return null;
  return result.overridden ? result.raw : JSON.stringify(result.body.value, null, 2);
}

type RequestPreviewProps = { baseUrl: string; summary: OperationSummary; request: OperationRequest };

/** Fill the endpoint's inputs, call the live mock from the browser, inspect and edit the reply. */
export function RequestPreview({ baseUrl, summary, request }: RequestPreviewProps) {
  const { workspace, mock } = useMockContext();
  const custom = mock.sourceType === "custom";
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<PreviewValues>(() => initialValues(request));
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const idBase = useId();
  const mockPath = { ws: workspace.slug, slug: mock.slug };
  const overrides = useQuery(listMockOverridesOptions({ path: mockPath }));
  const save = useMutation(saveMockOverrideMutation());

  useEffect(() => () => inflight.current?.abort(), []);

  const groups = (["path", "query", "header"] as const).filter((group) => request.parameters[group].length > 0);
  const withBody = sendsBody(request) && request.body !== null;
  const missingPath = request.parameters.path.some((param) => !values.path[param.name]?.trim());
  const jsonBody = request.body !== null && isJsonMediaType(request.body.mediaType);
  const bodyInvalid = withBody && jsonBody && values.body.trim() !== "" && !isValidJson(values.body);
  const codes = statusCodes(summary);
  const hasOverride = (code: string) =>
    overrides.data?.data.some(
      (item) => item.method === summary.method && item.path === summary.path && String(item.code) === code,
    ) ?? false;
  const result = outcome.state === "done" ? outcome.result : null;
  const editable =
    canEditMocks(workspace.role) && result !== null && result.body.kind === "json" && codes.includes(String(result.status));
  const canSave = editing !== null && editing.valid && editing.text !== editing.initial && !save.isPending;

  const setParam = (group: ParamGroup, name: string, value: string) =>
    setValues((current) => ({ ...current, [group]: { ...current[group], [name]: value } }));

  async function send() {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setOutcome({ state: "sending" });
    try {
      const sent = await sendPreview(baseUrl, request, values, controller.signal);
      setOutcome({ state: "done", result: sent });
    } catch (error) {
      if (controller.signal.aborted) return;
      setOutcome({ state: "failed", message: error instanceof TypeError ? NETWORK_FAILURE : String(error) });
    }
  }

  function startEdit(current: PreviewResult) {
    const text = editorText(current);
    if (text !== null) setEditing({ initial: text, text, valid: true, error: null });
  }

  async function saveEdit() {
    if (!editing || !canSave || !result) return;
    const code = result.status;
    try {
      await save.mutateAsync({
        path: mockPath,
        body: { method: summary.method, path: summary.path, code, body: editing.text },
      });
    } catch (failure) {
      setEditing((current) => current && { ...current, error: errorMessage(failure) });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: listMockOverridesQueryKey({ path: mockPath }) });
    toast(`Saved. The mock now returns this response for ${code}.`);
    setEditing(null);
    await send();
  }

  return (
    <div className={styles.preview}>
      <section className={styles.box} aria-label="Request">
        <div className={styles.boxHead}>
          <span className={page.label}>Request</span>
          {/* Secondary while editing: Save is the view's one primary action then. */}
          <Button
            variant={editing ? "secondary" : "primary"}
            size="sm"
            disabled={missingPath || outcome.state === "sending" || editing !== null}
            onClick={() => void send()}
          >
            {outcome.state === "sending" ? "Sending…" : "Send"}
          </Button>
        </div>
        <code className={styles.url}>
          {request.method.toUpperCase()} {previewUrl(baseUrl, request, values)}
        </code>

        {groups.map((group) => (
          <div key={group} className={styles.group}>
            <span className={styles.groupTitle}>{GROUP_TITLES[group]}</span>
            {request.parameters[group].map((param) => {
              const id = `${idBase}-${group}-${param.name}`;
              return (
                <div key={param.name} className={styles.field}>
                  <label htmlFor={id} className={styles.fieldName}>
                    {param.name}
                    {param.required && <span className={styles.required}>*</span>}
                    <span className={styles.fieldType}>{schemaType(param.schema) ?? ""}</span>
                  </label>
                  <TextInput
                    id={id}
                    size="sm"
                    value={values[group][param.name] ?? ""}
                    placeholder={parameterPlaceholder(param)}
                    title={param.description ?? undefined}
                    onChange={(event) => setParam(group, param.name, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
        ))}

        {codes.length > 0 && (
          <div className={styles.group}>
            <span className={styles.groupTitle}>Status</span>
            <div className={styles.pills} role="group" aria-label="Status code">
              {codes.map((code) => {
                const saved = hasOverride(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className={styles.pill}
                    aria-pressed={values.code === code}
                    title={saved ? (custom ? "Edited response saved" : "Custom response saved") : undefined}
                    onClick={() => setValues((current) => ({ ...current, code: current.code === code ? "" : code }))}
                  >
                    {code}
                    {saved && <span className={styles.pillDot} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className={styles.group}>
          <span className={styles.groupTitle}>Prefer</span>
          <select
            className={styles.select}
            value={values.prefer}
            onChange={(event) => setValues((current) => ({ ...current, prefer: event.target.value }))}
          >
            <option value="">Default response</option>
            {preferOptions(summary).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        {withBody && request.body && (
          <label className={styles.group}>
            <span className={styles.groupTitle}>
              Body
              {request.body.required && <span className={styles.required}>*</span>}
              <span className={styles.fieldType}>{request.body.mediaType}</span>
            </span>
            <textarea
              className={styles.body}
              spellCheck={false}
              value={values.body}
              onChange={(event) => setValues((current) => ({ ...current, body: event.target.value }))}
            />
            {bodyInvalid && <span className={styles.invalid}>Body isn't valid JSON. The mock may reject it.</span>}
          </label>
        )}

        {groups.length === 0 && !withBody && (
          <span className={page.hint}>This endpoint takes no parameters or body.</span>
        )}
      </section>

      <section className={styles.box} aria-label="Response" aria-live="polite">
        <div className={styles.boxHead}>
          <span className={page.label}>Response</span>
          {result && (
            <span className={styles.status}>
              <span className={styles.statusCode} style={{ color: statusTone(result.status) }}>
                {result.status} {result.statusText}
              </span>
              <span>{result.durationMs} ms</span>
              {result.overridden && (
                <Badge variant="meta">{custom ? "Edited, differs from default" : "Custom response"}</Badge>
              )}
            </span>
          )}
        </div>
        {result && editable && editing === null && (
          <div className={styles.actions}>
            <Button size="sm" onClick={() => startEdit(result)}>
              Edit
            </Button>
            {result.overridden && (
              <Button size="sm" onClick={() => setConfirmReset(true)}>
                Reset to default
              </Button>
            )}
          </div>
        )}
        {outcome.state === "idle" && <span className={page.hint}>Send the request to see the mock's response.</span>}
        {outcome.state === "sending" && <span className={page.hint}>Waiting for the mock…</span>}
        {outcome.state === "failed" && <Notice kind="error">{outcome.message}</Notice>}
        {result && editing === null && (
          <>
            {result.contentType && <code className={styles.url}>{result.contentType}</code>}
            {result.body.kind === "json" && <JsonViewer value={result.body.value} />}
            {result.body.kind === "text" && <CodeBlock maxHeight={480}>{result.body.text}</CodeBlock>}
            {result.body.kind === "empty" && <span className={page.hint}>Empty body.</span>}
          </>
        )}
        {result && editing && (
          <div className={styles.editor}>
            {editing.error && <Notice kind="error">{editing.error}</Notice>}
            <Suspense fallback={<span className={page.hint}>Loading editor…</span>}>
              <JsonEditor
                value={editing.text}
                onChange={(text) => setEditing((current) => current && { ...current, text })}
                onValidityChange={(valid) => setEditing((current) => current && { ...current, valid })}
                onSubmit={() => void saveEdit()}
              />
            </Suspense>
            {!editing.valid && <span className={styles.invalid}>Response isn't valid JSON.</span>}
            <div className={styles.actions}>
              <Button size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void saveEdit()}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
        {confirmReset && result && (
          <ResetOverrideModal
            ws={workspace.slug}
            slug={mock.slug}
            custom={custom}
            method={summary.method}
            path={summary.path}
            code={result.status}
            onClose={() => setConfirmReset(false)}
            onReset={() => {
              setConfirmReset(false);
              void send();
            }}
          />
        )}
      </section>
    </div>
  );
}
