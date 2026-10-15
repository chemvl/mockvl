import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  createWorkspaceInvitesMutation,
  listWorkspaceInvitesQueryKey,
  listWorkspaceMembersQueryKey,
} from "@/client/@tanstack/react-query.gen";
import { type Chip, ChipInput } from "@/components/ChipInput/ChipInput";
import { Button, Checkbox, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { useToast } from "@/components/Toast/toast-context";
import { INVITE_ROLE_OPTIONS } from "@/features/workspaces/permissions";
import { errorMessage } from "@/lib/api/errors";
import type { InviteRole, Workspace, WorkspaceMember } from "@/lib/api/types";
import page from "@/styles/page.module.scss";
import styles from "./InviteModal.module.scss";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteModalProps = { workspace: Workspace; members: readonly WorkspaceMember[]; onClose: () => void };

export function InviteModal({ workspace, members, onClose }: InviteModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const roleLabelId = useId();
  const errorId = useId();
  const [chips, setChips] = useState<Chip[]>([]);
  const [memberHint, setMemberHint] = useState<string | null>(null);
  const [role, setRole] = useState<InviteRole>("editor");
  // Per-email failures from the last send, or the request error.
  const [failures, setFailures] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);

  const path = { ws: workspace.slug };
  const send = useMutation({
    ...createWorkspaceInvitesMutation(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: listWorkspaceInvitesQueryKey({ path }) });
      void queryClient.invalidateQueries({ queryKey: listWorkspaceMembersQueryKey({ path }) });
      const ok = result.data.filter((item) => item.status === "sent" || item.status === "resent");
      const bad = result.data.filter((item) => item.status !== "sent" && item.status !== "resent");
      if (bad.length === 0) {
        onClose();
        toast(ok.length === 1 ? "Invite sent" : `${ok.length} invites sent`);
        return;
      }
      setChips(bad.map((item) => ({ email: item.email, valid: true })));
      setFailures(bad.map((item) => item.message ?? `${item.email} couldn't be invited.`));
    },
    onError: (failure) => setRequestError(errorMessage(failure)),
  });

  function addChips(raw: string[]) {
    const memberEmails = new Set(members.map((member) => member.email.toLowerCase()));
    const next = [...chips];
    for (const value of raw) {
      const email = value.trim().toLowerCase();
      if (email === "" || next.some((chip) => chip.email === email)) continue;
      if (memberEmails.has(email)) {
        // Stays until another member is skipped: each typed separator is its own onAdd call.
        setMemberHint(`${email} is already a member.`);
        continue;
      }
      next.push({ email, valid: EMAIL_PATTERN.test(email) });
    }
    setChips(next);
  }

  const firstInvalid = chips.find((chip) => !chip.valid);
  const validCount = chips.filter((chip) => chip.valid).length;
  const canSend = validCount > 0 && !firstInvalid && !send.isPending;

  return (
    <Modal
      title={`Invite to ${workspace.name}`}
      width={500}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={() => {
              setFailures([]);
              setRequestError(null);
              send.mutate({ path, body: { emails: chips.map((chip) => chip.email), role } });
            }}
          >
            {send.isPending ? "Sending…" : `Send ${validCount} invite${validCount === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <span className={page.sectionTitle}>Google account emails</span>
        <ChipInput
          chips={chips}
          onAdd={addChips}
          onRemove={(index) => setChips(chips.filter((_, at) => at !== index))}
          placeholder="Add more…"
          ariaLabel="Google account emails"
          describedBy={firstInvalid ? errorId : undefined}
          autoFocus
        />
        {firstInvalid && (
          <span id={errorId} className={styles.error}>
            {firstInvalid.email} isn't a valid email address.
          </span>
        )}
        {memberHint && <span className={page.hint}>{memberHint}</span>}
      </div>
      <div className={styles.field} role="radiogroup" aria-labelledby={roleLabelId}>
        <span id={roleLabelId} className={page.sectionTitle}>
          Role
        </span>
        {INVITE_ROLE_OPTIONS.map((option) => (
          <Checkbox
            key={option.value}
            type="radio"
            name="invite-role"
            value={option.value}
            label={option.label}
            checked={role === option.value}
            onChange={() => setRole(option.value)}
          />
        ))}
      </div>
      <p className={`${page.hint} ${styles.flush}`}>
        Invites expire after 7 days. People sign in with Google using the invited address.
      </p>
      {failures.length > 0 && (
        <Notice kind="error">
          <span className={styles.lines}>{failures.join("\n")}</span>
        </Notice>
      )}
      {requestError && <Notice kind="error">{requestError}</Notice>}
    </Modal>
  );
}
