import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  getMeOptions,
  listWorkspaceInvitesOptions,
  listWorkspaceInvitesQueryKey,
  listWorkspaceMembersOptions,
  listWorkspaceMembersQueryKey,
  resendWorkspaceInviteMutation,
  revokeWorkspaceInviteMutation,
  updateWorkspaceMemberMutation,
} from "@/client/@tanstack/react-query.gen";
import type { ListWorkspaceMembersResponse } from "@/client/types.gen";
import { type DataColumn, DataTable } from "@/components/DataTable/DataTable";
import { Avatar } from "@/components/Avatar/Avatar";
import { Button, Notice } from "@/components/ds";
import { PlaceholderRows } from "@/components/Placeholder/PlaceholderRows";
import { ErrorState } from "@/components/QueryState/QueryState";
import { useToast } from "@/components/Toast/toast-context";
import { LeaveWorkspaceModal } from "@/features/workspaces/LeaveWorkspaceModal";
import {
  canManageMember,
  canManageWorkspace,
  INVITE_ROLE_OPTIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from "@/features/workspaces/permissions";
import { errorMessage } from "@/lib/api/errors";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/api/types";
import { formatInviteDates, formatLastActive, plural } from "@/lib/format";
import { useWorkspace } from "@/pages/workspace/workspace-context";
import page from "@/styles/page.module.scss";
import { InviteModal } from "./InviteModal";
import styles from "./MembersPage.module.scss";
import { RemoveMemberModal } from "./RemoveMemberModal";

const ROLE_ORDER: readonly WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];

export function MembersPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const path = { ws: workspace.slug };
  const membersKey = listWorkspaceMembersQueryKey({ path });
  const invitesKey = listWorkspaceInvitesQueryKey({ path });

  const members = useQuery(listWorkspaceMembersOptions({ path }));
  const invites = useQuery(listWorkspaceInvitesOptions({ path }));
  const me = useQuery(getMeOptions());

  const [roleError, setRoleError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [leaving, setLeaving] = useState(false);

  const setMemberRole = (userId: string, role: WorkspaceRole) =>
    queryClient.setQueryData<ListWorkspaceMembersResponse>(membersKey, (old) =>
      old ? { data: old.data.map((member) => (member.userId === userId ? { ...member, role } : member)) } : old,
    );

  const changeRole = useMutation({
    ...updateWorkspaceMemberMutation(),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: membersKey });
      const previousRole = queryClient
        .getQueryData<ListWorkspaceMembersResponse>(membersKey)
        ?.data.find((member) => member.userId === variables.path.userId)?.role;
      setMemberRole(variables.path.userId, variables.body.role);
      return { previousRole };
    },
    onSuccess: (result) => {
      const member = result.data;
      setMemberRole(member.userId, member.role);
      toast(`${member.name ?? member.email} is now ${ROLE_LABELS[member.role]}`);
    },
    onError: (failure, variables, context) => {
      // Restore only this member's row, so a concurrent change to another row survives.
      if (context?.previousRole) setMemberRole(variables.path.userId, context.previousRole);
      setRoleError(errorMessage(failure));
    },
  });

  const resend = useMutation({
    ...resendWorkspaceInviteMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitesKey });
      toast("Invite resent");
    },
    onError: (failure) => setInviteError(errorMessage(failure)),
  });

  const revoke = useMutation({
    ...revokeWorkspaceInviteMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitesKey });
      toast("Invite revoked");
    },
    onError: (failure) => setInviteError(errorMessage(failure)),
  });

  const canManage = canManageWorkspace(workspace.role);
  const meId = me.data?.data.id ?? "";
  const memberList = members.data?.data ?? [];
  const inviteList = invites.data?.data ?? [];
  const inviteBusy = resend.isPending || revoke.isPending;

  const columns: DataColumn<WorkspaceMember>[] = [
    {
      key: "member",
      header: "Member",
      width: "minmax(0,1fr)",
      render: (member) => (
        <div className={styles.member}>
          <Avatar name={member.name} email={member.email} src={member.avatarUrl} size={32} />
          <div className={page.cellStack}>
            <span className={styles.memberName}>
              {member.name ?? member.email}
              {member.userId === meId && " (you)"}
            </span>
            <span className={styles.memberEmail}>{member.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      width: "140px",
      render: (member) =>
        canManageMember(workspace.role, meId, member) ? (
          <span className={styles.selectWrap}>
            <select
              className={styles.select}
              value={member.role}
              aria-label={`Role for ${member.name ?? member.email}`}
              onChange={(event) => {
                const role = INVITE_ROLE_OPTIONS.find((option) => option.value === event.target.value)?.value;
                if (!role) return;
                setRoleError(null);
                changeRole.mutate({ path: { ws: workspace.slug, userId: member.userId }, body: { role } });
              }}
            >
              {INVITE_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {ROLE_LABELS[option.value]}
                </option>
              ))}
            </select>
            <span className={styles.caret} aria-hidden="true">
              ▾
            </span>
          </span>
        ) : (
          <span className={styles.roleText}>{ROLE_LABELS[member.role]}</span>
        ),
    },
    {
      key: "lastActive",
      header: "Last active",
      width: "120px",
      hideNarrow: true,
      render: (member) => <span className={page.cellSmall}>{formatLastActive(member.lastActiveAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "40px",
      render: (member) => {
        if (canManageMember(workspace.role, meId, member)) {
          return (
            <Button
              variant="text"
              aria-label={`Remove ${member.name ?? member.email}`}
              onClick={() => setRemoving(member)}
              style={{ color: "var(--muted)" }}
            >
              ✕
            </Button>
          );
        }
        if (member.userId === meId && (workspace.role === "editor" || workspace.role === "viewer")) {
          return (
            <Button variant="link-muted" onClick={() => setLeaving(true)}>
              Leave
            </Button>
          );
        }
        return null;
      },
    },
  ];

  let table: ReactNode;
  if (members.isError) table = <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  else if (me.isError) table = <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  else if (members.isPending || me.isPending) table = <PlaceholderRows count={4} />;
  else table = <DataTable columns={columns} rows={memberList} rowKey={(member) => member.userId} />;

  const showOnlyYou = canManage && members.isSuccess && memberList.length === 1 && invites.isSuccess && inviteList.length === 0;

  return (
    <div className={styles.layout}>
      <div className={page.page}>
        <div className={page.titleRow}>
          <div className={page.titleBlock}>
            <h1 className={page.title}>Members</h1>
            {members.isSuccess && (
              <span className={page.meta}>
                {plural(memberList.length, "member")}
                {inviteList.length > 0 && ` · ${plural(inviteList.length, "pending invite")}`}
              </span>
            )}
          </div>
          {canManage && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              Invite people
            </Button>
          )}
        </div>

        {roleError && (
          <Notice kind="error" onDismiss={() => setRoleError(null)}>
            {roleError}
          </Notice>
        )}
        {table}

        {showOnlyYou && (
          <div className={styles.onlyYou}>
            <h2 className={styles.onlyYouTitle}>Just you so far</h2>
            <p className={page.bodyText}>Invite people to share mocks with your team.</p>
            <Button onClick={() => setInviting(true)}>Invite people</Button>
          </div>
        )}

        {inviteList.length > 0 && (
          <section className={styles.invites}>
            <span className={page.label}>Pending invites</span>
            {inviteError && (
              <Notice kind="error" onDismiss={() => setInviteError(null)}>
                {inviteError}
              </Notice>
            )}
            <div className={styles.inviteCard}>
              {inviteList.map((invite) => (
                <div key={invite.id} className={styles.inviteRow}>
                  <span className={styles.inviteEmail}>{invite.email}</span>
                  <span className={styles.inviteRole}>{ROLE_LABELS[invite.role]}</span>
                  <span className={styles.inviteDates}>{formatInviteDates(invite)}</span>
                  <span className={styles.inviteActions}>
                    {canManage && (
                      <>
                        <Button
                          variant="link"
                          disabled={inviteBusy}
                          onClick={() => {
                            setInviteError(null);
                            resend.mutate({ path: { ws: workspace.slug, inviteId: invite.id } });
                          }}
                        >
                          Resend
                        </Button>
                        {!invite.expired && (
                          <Button
                            variant="link-muted"
                            disabled={inviteBusy}
                            onClick={() => {
                              setInviteError(null);
                              revoke.mutate({ path: { ws: workspace.slug, inviteId: invite.id } });
                            }}
                          >
                            Revoke
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className={styles.aside}>
        <span className={page.label}>Roles</span>
        {ROLE_ORDER.map((role) => (
          <div key={role} className={styles.roleItem}>
            <span className={page.sectionTitle}>{ROLE_LABELS[role]}</span>
            <span className={styles.roleDescription}>{ROLE_DESCRIPTIONS[role]}</span>
          </div>
        ))}
      </aside>

      {inviting && <InviteModal workspace={workspace} members={memberList} onClose={() => setInviting(false)} />}
      {removing && <RemoveMemberModal workspace={workspace} member={removing} onClose={() => setRemoving(null)} />}
      {leaving && <LeaveWorkspaceModal workspace={workspace} onClose={() => setLeaving(false)} />}
    </div>
  );
}
