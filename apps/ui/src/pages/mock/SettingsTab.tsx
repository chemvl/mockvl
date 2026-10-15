import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { getMockQueryKey, updateMockMutation } from "@/client/@tanstack/react-query.gen";
import { RequestsField, ResponsesField } from "@/components/BehaviorFields/BehaviorFields";
import { Button, Notice, TextInput } from "@/components/ds";
import { SlugAvailability } from "@/components/SlugInput/SlugAvailability";
import { SlugInput } from "@/components/SlugInput/SlugInput";
import { useToast } from "@/components/Toast/toast-context";
import { slugCheckBlocks, useSlugAvailability } from "@/features/mocks/use-slug-availability";
import { canEditMocks } from "@/features/workspaces/permissions";
import { applyMock } from "@/lib/api/cache";
import { errorMessage } from "@/lib/api/errors";
import type { MockDetail, UpdateMockBody, Workspace } from "@/lib/api/types";
import { mockUrlPrefix } from "@/lib/mock-url";
import { isValidSlug } from "@/lib/slug";
import page from "@/styles/page.module.scss";
import { DeleteMockModal } from "./DeleteMockModal";
import { useMockContext } from "./mock-context";
import styles from "./SettingsTab.module.scss";

function SettingsForm({ workspace, mock }: { workspace: Workspace; mock: MockDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(mock.name);
  const [slug, setSlug] = useState(mock.slug);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const slugCheck = useSlugAvailability(workspace.slug, slug, mock.slug);
  const path = { ws: workspace.slug, slug: mock.slug };

  const update = useMutation({
    ...updateMockMutation(),
    onSuccess: (result) => {
      const next = result.data;
      applyMock(queryClient, workspace.slug, next);
      if (next.slug !== mock.slug) {
        navigate(`/${workspace.slug}/${next.slug}/settings`, { replace: true });
        queryClient.removeQueries({ queryKey: getMockQueryKey({ path }) });
      }
      toast("Settings saved");
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== mock.name;
  const slugChanged = slug !== mock.slug;
  const canSave =
    (nameChanged || slugChanged) && trimmedName !== "" && isValidSlug(slug) && !slugCheckBlocks(slugCheck) && !update.isPending;

  function patch(body: UpdateMockBody) {
    setError(null);
    update.mutate({ path, body });
  }

  return (
    <div className={styles.settings}>
      <section className={styles.section}>
        <span className={page.sectionTitle}>Name and URL</span>
        <TextInput
          value={name}
          maxLength={80}
          aria-label="Name"
          onChange={(event) => setName(event.target.value)}
          style={{ width: "100%" }}
        />
        <div className={styles.slugRow}>
          <SlugInput
            prefix={mockUrlPrefix(workspace.slug)}
            value={slug}
            invalid={slugCheckBlocks(slugCheck)}
            onChange={setSlug}
          />
          <Button
            disabled={!canSave}
            onClick={() =>
              patch({ ...(nameChanged ? { name: trimmedName } : {}), ...(slugChanged ? { slug } : {}) })
            }
          >
            Save
          </Button>
        </div>
        <SlugAvailability check={slugCheck} />
        <span className={page.hint}>Changing the slug changes the URL. The old URL stops working.</span>
      </section>

      {mock.sourceType !== "custom" && (
        <ResponsesField
          name="settings-responses"
          value={mock.responseMode}
          disabled={update.isPending}
          onChange={(responseMode) => patch({ responseMode })}
        />
      )}

      <RequestsField
        validateRequests={mock.validateRequests}
        cors={mock.cors}
        disabled={update.isPending}
        showValidation={mock.sourceType !== "custom"}
        onChange={(change) => patch(change)}
      />

      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className={styles.danger}>
        <div className={styles.dangerText}>
          <span className={page.sectionTitle}>Delete this mock</span>
          <span className={page.hint}>The URL stops responding. Versions and usage history are removed.</span>
        </div>
        <Button style={{ color: "var(--error-text)" }} onClick={() => setDeleteOpen(true)}>
          Delete mock
        </Button>
      </div>

      {deleteOpen && <DeleteMockModal workspace={workspace} mock={mock} onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}

export function SettingsTab() {
  const { workspace, mock } = useMockContext();
  if (!canEditMocks(workspace.role)) return <Navigate to={`/${workspace.slug}/${mock.slug}`} replace />;
  // Re-key on every server update so the form starts from the saved values.
  return <SettingsForm key={`${mock.id}:${mock.updatedAt}`} workspace={workspace} mock={mock} />;
}
