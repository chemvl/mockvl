import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { createMockMutation } from "@/client/@tanstack/react-query.gen";
import { RequestsField, ResponsesField } from "@/components/BehaviorFields/BehaviorFields";
import { Button, CodeBlock, Notice, TextInput } from "@/components/ds";
import { type FileState, type PickerTab, pickSource } from "@/components/SchemaSourcePicker/schema-source";
import { SchemaSourcePicker } from "@/components/SchemaSourcePicker/SchemaSourcePicker";
import { SlugAvailability } from "@/components/SlugInput/SlugAvailability";
import { SlugInput } from "@/components/SlugInput/SlugInput";
import { slugCheckBlocks, useSlugAvailability } from "@/features/mocks/use-slug-availability";
import { canEditMocks } from "@/features/workspaces/permissions";
import { applyMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import { buildAsideCurl } from "@/lib/curl";
import { plural } from "@/lib/format";
import { mockUrl, mockUrlPrefix } from "@/lib/mock-url";
import { isValidSlug, SLUG_INVALID_MESSAGE, slugify } from "@/lib/slug";
import type { MockLocationState } from "@/pages/mock/mock-context";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import styles from "./NewMockPage.module.scss";

export function NewMockPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<PickerTab>("file");
  const [file, setFile] = useState<FileState>({ status: "empty" });
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const [responseMode, setResponseMode] = useState<"static" | "dynamic">("static");
  const [validateRequests, setValidateRequests] = useState(workspace.defaultValidate);
  const [cors, setCors] = useState(workspace.defaultCors);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-derived from the name until the user edits the slug field.
  const slug = editedSlug ?? slugify(name);
  const slugCheck = useSlugAvailability(workspace.slug, slug);

  const create = useMutation({
    ...createMockMutation(),
    onSuccess: (result) => {
      const mock = result.data;
      applyMock(queryClient, workspace.slug, mock);
      const notice =
        mock.sourceType === "custom"
          ? "Mock created. Add its first endpoint."
          : `Mock is live with ${plural(mock.endpointCount, "endpoint")}.`;
      const state: MockLocationState = { notice };
      navigate(`/${workspace.slug}/${mock.slug}`, { state });
    },
    onError: (failure) => setFormError(errorMessage(failure)),
  });

  function submit() {
    setFormError(null);
    const picked = tab === "blank" ? { source: { type: "custom" as const } } : pickSource(tab, file, url);
    if ("error" in picked) {
      setFormError(picked.error);
      return;
    }
    if (!name.trim()) {
      setFormError("Enter a name for the mock.");
      return;
    }
    if (!isValidSlug(slug)) {
      setFormError(SLUG_INVALID_MESSAGE);
      return;
    }
    if (slugCheck.state === "taken") {
      setFormError(`${slug} is already taken in ${workspace.name}.`);
      return;
    }
    if (slugCheck.state === "reserved") {
      setFormError(`${slug} is reserved. Choose another slug.`);
      return;
    }
    create.mutate({
      path: { ws: workspace.slug },
      body: { name: name.trim(), slug, responseMode, validateRequests, cors, source: picked.source },
    });
  }

  if (!canEditMocks(workspace.role)) return <Navigate to={`/${workspace.slug}`} replace />;

  const busy = create.isPending || file.status === "parsing";
  const visibility =
    workspace.memberCount === 1
      ? "Only you can see and edit mocks in this workspace."
      : `Everyone in ${workspace.name} can see this mock. Owners, Admins and Editors can change it.`;

  return (
    <div className={styles.grid}>
      <div className={styles.form}>
        <div className={page.titleBlock}>
          <Link to={`/${workspace.slug}`} className={page.crumb}>
            Resources /
          </Link>
          <h1 className={page.title}>New mock</h1>
        </div>

        <section className={styles.section}>
          <span className={page.label}>1 · Schema</span>
          <SchemaSourcePicker
            ws={workspace.slug}
            tab={tab}
            onTabChange={setTab}
            allowBlank
            file={file}
            onFileChange={setFile}
            url={url}
            onUrlChange={setUrl}
            onError={setFormError}
          />
        </section>

        <section className={styles.section}>
          <span className={page.label}>2 · Name and URL</span>
          <TextInput
            value={name}
            maxLength={80}
            placeholder="Orders API"
            aria-label="Name"
            onChange={(event) => setName(event.target.value)}
            style={{ width: "100%" }}
          />
          <SlugInput
            prefix={mockUrlPrefix(workspace.slug)}
            value={slug}
            invalid={slugCheckBlocks(slugCheck)}
            onChange={setEditedSlug}
          />
          <SlugAvailability check={slugCheck} />
        </section>

        <section className={styles.section}>
          <span className={page.label}>3 · Behavior</span>
          {tab !== "blank" && (
            <ResponsesField name="new-mock-responses" value={responseMode} onChange={setResponseMode} />
          )}
          <RequestsField
            showValidation={tab !== "blank"}
            validateRequests={validateRequests}
            cors={cors}
            onChange={(patch) => {
              if (patch.validateRequests !== undefined) setValidateRequests(patch.validateRequests);
              if (patch.cors !== undefined) setCors(patch.cors);
            }}
          />
        </section>

        {formError && (
          <Notice kind="error" onDismiss={() => setFormError(null)}>
            {formError}
          </Notice>
        )}

        <div className={styles.actions}>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? (tab === "blank" ? "Creating…" : "Parsing schema…") : "Create mock"}
          </Button>
          <Button onClick={() => navigate(`/${workspace.slug}`)}>Cancel</Button>
        </div>
      </div>

      <aside className={styles.aside}>
        <span className={page.label}>After creating</span>
        <p className={page.bodyText}>
          {tab === "blank"
            ? "Add endpoints on the mock's Endpoints tab, then call them at this URL."
            : "Call any path from the schema. Pick a status code or a named example with the Prefer header."}
        </p>
        <CodeBlock>{buildAsideCurl(mockUrl(workspace.slug, slug || "your-mock"))}</CodeBlock>
        <span className={page.hint}>{visibility}</span>
      </aside>
    </div>
  );
}
