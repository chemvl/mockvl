import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  createCustomEndpointMutation,
  getCustomEndpointOptions,
  getMockQueryKey,
  listMockOverridesOptions,
  updateCustomEndpointMutation,
} from "@/client/@tanstack/react-query.gen";
import { Badge, Button, Checkbox, CodeBlock, Notice, TextInput } from "@/components/ds";
import { ErrorState, LoadingState } from "@/components/QueryState/QueryState";
import { useToast } from "@/components/Toast/toast-context";
import { canEditMocks } from "@/features/workspaces/permissions";
import { refreshCustomMock } from "@/lib/api/cache";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { CustomEndpoint, OperationSummary } from "@/lib/api/types";
import { defaultServedStatus, headerProblem, isNoBodyStatus, pathParams } from "@/lib/custom-endpoint";
import { plural } from "@/lib/format";
import { NotFoundContent } from "@/pages/workspace/NotFound";
import page from "@/styles/page.module.scss";
import styles from "./EndpointEditorPage.module.scss";
import { type MockLocationState, useMockContext } from "./mock-context";

// CodeMirror downloads with the first body editor only.
const JsonEditor = lazy(() =>
  import("@/components/JsonEditor/JsonEditor").then((module) => ({ default: module.JsonEditor })),
);

type Method = OperationSummary["method"];
type EndpointKey = { method: Method; path: string };
type HeaderRow = { id: string; name: string; value: string };
type ResponseDraft = { id: string; status: string; headers: HeaderRow[]; empty: boolean; body: string; bodyValid: boolean };
type Draft = { method: Method; path: string; summary: string; responses: ResponseDraft[] };

const METHODS: readonly Method[] = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const ADD_STATUS_ORDER = [200, 201, 204, 400, 404, 500];

let sequence = 0;
const newId = () => String(++sequence);

const isMethod = (value: string): value is Method => (METHODS as readonly string[]).includes(value);

function responseDraft(status: number, body: string | null, headers: Record<string, string> = {}): ResponseDraft {
  return {
    id: newId(),
    status: String(status),
    headers: Object.entries(headers).map(([name, value]) => ({ id: newId(), name, value })),
    empty: body === null,
    body: body ?? "{}",
    bodyValid: true,
  };
}

function blankDraft(): Draft {
  return { method: "get", path: "", summary: "", responses: [responseDraft(200, "{}")] };
}

function toDraft(endpoint: CustomEndpoint): Draft {
  return {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? "",
    responses: endpoint.responses.map((response) => responseDraft(response.status, response.body, response.headers)),
  };
}

const bodyOf = (response: ResponseDraft): string | null =>
  response.empty || isNoBodyStatus(Number(response.status)) ? null : response.body;

function toEndpoint(draft: Draft): CustomEndpoint {
  const summary = draft.summary.trim();
  return {
    kind: "http",
    method: draft.method,
    path: draft.path.trim(),
    ...(summary ? { summary } : {}),
    responses: draft.responses.map((response) => ({
      status: Number(response.status),
      headers: Object.fromEntries(
        response.headers.filter((header) => header.name.trim() !== "").map((header) => [header.name.trim(), header.value]),
      ),
      body: bodyOf(response),
    })),
  };
}

function nextStatus(responses: readonly ResponseDraft[]): number {
  const used = new Set(responses.map((response) => Number(response.status)));
  return ADD_STATUS_ORDER.find((status) => !used.has(status)) ?? 200;
}

/** `:ws/:slug/endpoints/new` and `:ws/:slug/endpoints/edit?method=&path=` (custom mocks only). */
export function EndpointEditorPage() {
  const { mock } = useMockContext();
  const location = useLocation();
  const [params] = useSearchParams();
  if (mock.sourceType !== "custom") return <NotFoundContent />;
  if (location.pathname.endsWith("/endpoints/new")) return <NewEndpoint />;
  const method = params.get("method") ?? "";
  const path = params.get("path") ?? "";
  if (!isMethod(method) || path === "") return <NotFoundContent />;
  return <EditEndpoint key={`${method} ${path}`} endpointKey={{ method, path }} />;
}

function NewEndpoint() {
  const { workspace, mock } = useMockContext();
  const queryClient = useQueryClient();
  const [initial] = useState(blankDraft);
  return (
    <EndpointForm
      initial={initial}
      baseVersion={mock.liveVersion.number}
      original={null}
      onReload={() =>
        void queryClient.invalidateQueries({ queryKey: getMockQueryKey({ path: { ws: workspace.slug, slug: mock.slug } }) })
      }
    />
  );
}

function EditEndpoint({ endpointKey }: { endpointKey: EndpointKey }) {
  const { workspace, mock } = useMockContext();
  const query = useQuery(
    getCustomEndpointOptions({ path: { ws: workspace.slug, slug: mock.slug }, query: endpointKey }),
  );
  if (query.isPending) return <LoadingState label="Loading endpoint…" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundContent />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const { version, endpoint } = query.data.data;
  // Keyed by version: Reload after a conflict rebuilds the form from the latest data.
  return (
    <EndpointForm
      key={version}
      initial={toDraft(endpoint)}
      baseVersion={version}
      original={endpointKey}
      onReload={() => void query.refetch()}
    />
  );
}

type EndpointFormProps = {
  initial: Draft;
  baseVersion: number;
  /** The endpoint being edited; null when creating. */
  original: EndpointKey | null;
  onReload: () => void;
};

function EndpointForm({ initial, baseVersion, original, onReload }: EndpointFormProps) {
  const { workspace, mock } = useMockContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [initialEndpoint] = useState(() => toEndpoint(initial));
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const mockPath = { ws: workspace.slug, slug: mock.slug };
  const base = `/${workspace.slug}/${mock.slug}`;
  const readOnly = !canEditMocks(workspace.role);
  const overrides = useQuery({ ...listMockOverridesOptions({ path: mockPath }), enabled: original !== null });

  const endpoint = toEndpoint(draft);
  const dirty = JSON.stringify(endpoint) !== JSON.stringify(initialEndpoint);
  const bodiesValid = draft.responses.every((response) => bodyOf(response) === null || response.bodyValid);
  const edits = original
    ? (overrides.data?.data ?? []).filter((item) => item.method === original.method && item.path === original.path)
    : [];
  const keyChanged = original !== null && (endpoint.method !== original.method || endpoint.path !== original.path);
  const initialBodies = new Map(initialEndpoint.responses.map((response) => [response.status, response.body]));
  const defaultChangedUnderEdit =
    !keyChanged &&
    endpoint.responses.some(
      (response) =>
        edits.some((item) => item.code === response.status) &&
        initialBodies.has(response.status) &&
        initialBodies.get(response.status) !== response.body,
    );
  const served = defaultServedStatus(endpoint.responses.map((response) => response.status).filter(Number.isInteger));
  const params = pathParams(draft.path);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function onSaved(result: { data: { version: number; endpoint: CustomEndpoint } }) {
    await refreshCustomMock(queryClient, workspace.slug, mock.slug);
    toast(`Saved. Version ${result.data.version} is live.`);
    const state: MockLocationState = { openKey: `${result.data.endpoint.method} ${result.data.endpoint.path}` };
    navigate(base, { state });
  }
  const onFailed = (failure: unknown) =>
    setError({ text: errorMessage(failure), conflict: failure instanceof ApiError && failure.code === "VERSION_CONFLICT" });
  const create = useMutation({ ...createCustomEndpointMutation(), onSuccess: onSaved, onError: onFailed });
  const update = useMutation({ ...updateCustomEndpointMutation(), onSuccess: onSaved, onError: onFailed });
  const saving = create.isPending || update.isPending;
  const canSave = !readOnly && !saving && dirty && bodiesValid;

  function save() {
    if (!canSave) return;
    setError(null);
    const body = { baseVersion, endpoint };
    if (original) update.mutate({ path: mockPath, query: original, body });
    else create.mutate({ path: mockPath, body });
  }

  const setResponse = (id: string, patch: Partial<ResponseDraft>) =>
    setDraft((current) => ({
      ...current,
      responses: current.responses.map((response) => (response.id === id ? { ...response, ...patch } : response)),
    }));

  return (
    <div className={styles.editor}>
      <div className={page.titleBlock}>
        <Link to={base} className={page.crumb}>
          Endpoints /
        </Link>
        <span className={page.sectionTitle}>
          {original ? (
            <>
              Edit <span className={page.mono}>{`${original.method.toUpperCase()} ${original.path}`}</span>
            </>
          ) : (
            "New endpoint"
          )}
        </span>
      </div>

      {readOnly && <Notice kind="info">Viewers can see endpoints but not change them.</Notice>}
      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error.text}{" "}
          {error.conflict && (
            <Button
              size="sm"
              variant="link"
              onClick={() => {
                setError(null);
                onReload();
              }}
            >
              Reload
            </Button>
          )}
        </Notice>
      )}
      {keyChanged && edits.length > 0 && (
        <Notice kind="warning">Changing the method or path detaches {plural(edits.length, "edited response")}.</Notice>
      )}
      {defaultChangedUnderEdit && (
        <Notice kind="warning">This status has an active edit; the mock keeps serving the edit until you reset it.</Notice>
      )}

      <fieldset className={styles.fieldset} disabled={readOnly}>
        <div className={styles.endpointRow}>
          <label className={styles.field}>
            <span className={page.label}>Method</span>
            <span className={styles.selectWrap}>
              <select
                className={styles.select}
                value={draft.method}
                onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value as Method }))}
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method.toUpperCase()}
                  </option>
                ))}
              </select>
              <span className={styles.caret} aria-hidden="true">
                ▾
              </span>
            </span>
          </label>
          <label className={styles.field}>
            <span className={page.label}>Path</span>
            <TextInput
              value={draft.path}
              placeholder="/users/{id}"
              spellCheck={false}
              maxLength={2000}
              onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
              style={{ width: "100%", fontFamily: "var(--font-mono)" }}
            />
          </label>
        </div>
        <span className={page.hint}>
          {params.length > 0
            ? `Path parameters: ${params.join(", ")}`
            : "Use {name} for a path parameter, like /users/{id}."}
        </span>
        <label className={styles.field}>
          <span className={page.label}>Summary</span>
          <TextInput
            value={draft.summary}
            placeholder="Optional"
            maxLength={200}
            onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
            style={{ width: "100%" }}
          />
        </label>

        <span className={page.label}>Responses</span>
        {draft.responses.map((response) => (
          <ResponseCard
            key={response.id}
            response={response}
            servedByDefault={Number(response.status) === served}
            canRemove={draft.responses.length > 1}
            readOnly={readOnly}
            onChange={(patch) => setResponse(response.id, patch)}
            onRemove={() =>
              setDraft((current) => ({ ...current, responses: current.responses.filter((item) => item.id !== response.id) }))
            }
            onSubmit={save}
          />
        ))}
        {!readOnly && (
          <div>
            <Button
              size="sm"
              onClick={() =>
                setDraft((current) => {
                  const status = nextStatus(current.responses);
                  return { ...current, responses: [...current.responses, responseDraft(status, isNoBodyStatus(status) ? null : "{}")] };
                })
              }
            >
              Add status
            </Button>
          </div>
        )}
      </fieldset>

      {!readOnly && (
        <div className={styles.actions}>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={() => navigate(base)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

type ResponseCardProps = {
  response: ResponseDraft;
  servedByDefault: boolean;
  canRemove: boolean;
  readOnly: boolean;
  onChange: (patch: Partial<ResponseDraft>) => void;
  onRemove: () => void;
  onSubmit: () => void;
};

function ResponseCard({ response, servedByDefault, canRemove, readOnly, onChange, onRemove, onSubmit }: ResponseCardProps) {
  const status = Number(response.status);
  const noBody = isNoBodyStatus(status);
  const empty = response.empty || noBody;
  const setHeader = (id: string, patch: Partial<HeaderRow>) =>
    onChange({ headers: response.headers.map((header) => (header.id === id ? { ...header, ...patch } : header)) });

  return (
    <section className={styles.card} aria-label={`Response ${response.status || "without status"}`}>
      <div className={styles.cardHead}>
        <TextInput
          size="sm"
          inputMode="numeric"
          aria-label="Status code"
          maxLength={3}
          value={response.status}
          onChange={(event) => onChange({ status: event.target.value.replace(/\D/g, "") })}
          style={{ width: 80, fontFamily: "var(--font-mono)" }}
        />
        {servedByDefault && <Badge variant="meta">Served by default</Badge>}
        {canRemove && !readOnly && (
          <Button size="sm" variant="text" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      <span className={page.label}>Headers</span>
      {response.headers.map((header) => {
        const problem = headerProblem(header.name);
        return (
          <div key={header.id} className={styles.headerRow}>
            <TextInput
              size="sm"
              aria-label="Header name"
              placeholder="X-Total-Count"
              value={header.name}
              invalid={problem !== null}
              onChange={(event) => setHeader(header.id, { name: event.target.value })}
            />
            <TextInput
              size="sm"
              aria-label="Header value"
              value={header.value}
              onChange={(event) => setHeader(header.id, { value: event.target.value })}
            />
            {!readOnly && (
              <Button
                size="sm"
                variant="text"
                onClick={() => onChange({ headers: response.headers.filter((item) => item.id !== header.id) })}
              >
                Remove
              </Button>
            )}
            {problem && <span className={styles.invalid}>{problem}</span>}
          </div>
        );
      })}
      {!readOnly && (
        <div>
          <Button
            size="sm"
            variant="text"
            onClick={() => onChange({ headers: [...response.headers, { id: newId(), name: "", value: "" }] })}
          >
            Add header
          </Button>
        </div>
      )}

      <span className={page.label}>Default body</span>
      <Checkbox
        checked={empty}
        disabled={noBody || readOnly}
        onChange={(event) => onChange({ empty: event.target.checked })}
        label={noBody ? `${status} responses have no body` : "Empty body"}
      />
      {!empty &&
        (readOnly ? (
          <CodeBlock maxHeight={360}>{response.body}</CodeBlock>
        ) : (
          <Suspense fallback={<span className={page.hint}>Loading editor…</span>}>
            <JsonEditor
              value={response.body}
              onChange={(body) => onChange({ body })}
              onValidityChange={(bodyValid) => onChange({ bodyValid })}
              onSubmit={onSubmit}
              // Bodies mount as status codes are typed; don't steal focus from the status input.
              autoFocus={false}
            />
          </Suspense>
        ))}
      {!empty && !response.bodyValid && <span className={styles.invalid}>Response isn't valid JSON.</span>}
    </section>
  );
}
