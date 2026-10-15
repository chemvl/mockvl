import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  acceptInviteMutation,
  declineInviteMutation,
  getInviteByTokenOptions,
  getMeOptions,
  listWorkspacesOptions,
} from "@/client/@tanstack/react-query.gen";
import { Avatar } from "@/components/Avatar/Avatar";
import { Button, Notice } from "@/components/ds";
import { LoadingState } from "@/components/QueryState/QueryState";
import { useToast } from "@/components/Toast/toast-context";
import { WorkspaceTile } from "@/components/WorkspaceTile/WorkspaceTile";
import { brand } from "@/config/brand";
import { useGoogleSignIn } from "@/features/auth/use-google-sign-in";
import { ROLE_LABELS } from "@/features/workspaces/permissions";
import { errorMessage } from "@/lib/api/errors";
import type { InviteRole } from "@/lib/api/types";
import { plural } from "@/lib/format";
import page from "@/styles/page.module.scss";
import styles from "./AcceptInvitePage.module.scss";

const ROLE_ARTICLE: Record<InviteRole, string> = { admin: "an", editor: "an", viewer: "a" };

const ROLE_ABILITY: Record<InviteRole, string> = {
  admin: "manage members and all of",
  editor: "create and change",
  viewer: "see and call",
};

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const invite = useQuery(getInviteByTokenOptions({ path: { token } }));
  const me = useQuery(getMeOptions());
  const lookup = invite.data?.data;

  // queryClient.clear() has already dropped the old account's data; refetch for the new one.
  const google = useGoogleSignIn({
    selectAccount: true,
    loginHint: lookup?.email,
    onSignedIn: () => {
      void invite.refetch();
      void me.refetch();
    },
  });

  const accept = useMutation({
    ...acceptInviteMutation(),
    // Returned promise keeps the button on "Joining…" until navigation.
    onSuccess: async (result) => {
      const joined = result.data;
      // The membership exists either way; if the refresh fails, AppLayout loads the list itself.
      await queryClient.fetchQuery({ ...listWorkspacesOptions(), staleTime: 0 }).catch(() => undefined);
      navigate(`/${joined.slug}`);
      toast(`You joined ${joined.name}`);
    },
  });

  const decline = useMutation({
    ...declineInviteMutation(),
    onSuccess: () => {
      navigate("/");
      toast("Invite declined");
    },
  });

  const goHome = (
    <div className={styles.actions}>
      <Button onClick={() => navigate("/")}>{`Go to ${brand.name}`}</Button>
    </div>
  );
  const switchAccount = (
    <Button disabled={!google.ready || google.signingIn} onClick={google.start}>
      Switch Google account
    </Button>
  );
  const googleError = google.error && <Notice kind="error">{google.error}</Notice>;

  let content: ReactNode;
  if (invite.isError) {
    content = (
      <>
        <h1 className={page.title}>This invite is no longer valid</h1>
        {goHome}
      </>
    );
  } else if (invite.isPending || me.isPending || !lookup) {
    content = <LoadingState label="Loading invite…" />;
  } else {
    const inviterName = lookup.inviter?.name ?? lookup.inviter?.email ?? "Someone";
    switch (lookup.state) {
      case "already_member":
        return <Navigate to={`/${lookup.workspace.slug}`} replace />;
      case "invalid":
        content = (
          <>
            <h1 className={page.title}>This invite is no longer valid</h1>
            {goHome}
          </>
        );
        break;
      case "expired":
        content = (
          <>
            <Heading title="This invite has expired">Ask {inviterName} to send a new one.</Heading>
            {goHome}
          </>
        );
        break;
      case "email_mismatch":
        content = (
          <>
            <Heading title={`This invite is for ${lookup.email}`}>
              You're signed in as {lookup.signedInEmail}. Switch to the invited account to join.
            </Heading>
            {googleError}
            <div className={styles.actions}>{switchAccount}</div>
          </>
        );
        break;
      case "valid": {
        const { workspace, role } = lookup;
        const user = me.data?.data;
        const busy = accept.isPending || decline.isPending;
        const actionError = accept.error ?? decline.error;
        content = (
          <>
            <WorkspaceTile name={workspace.name} size={40} />
            <Heading title={`Join ${workspace.name}`}>
              {`${inviterName} invited you as ${ROLE_ARTICLE[role]} ${ROLE_LABELS[role]}. `}
              {`You'll be able to ${ROLE_ABILITY[role]} the team's ${plural(workspace.mockCount, "mock")}.`}
            </Heading>
            <div className={styles.signedIn}>
              <Avatar name={user?.name ?? null} email={lookup.signedInEmail} src={user?.avatarUrl} size={28} />
              <div className={styles.signedInText}>
                <span className={styles.signedInLabel}>Signed in as</span>
                <span className={styles.signedInEmail}>{lookup.signedInEmail}</span>
              </div>
            </div>
            {actionError && <Notice kind="error">{errorMessage(actionError)}</Notice>}
            {googleError}
            <div className={styles.actions}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  decline.reset();
                  accept.mutate({ path: { token } });
                }}
              >
                {accept.isPending ? "Joining…" : "Join workspace"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  accept.reset();
                  decline.mutate({ path: { token } });
                }}
              >
                Decline
              </Button>
            </div>
            <p className={styles.footer}>
              Not you?{" "}
              <Button variant="link" disabled={!google.ready || google.signingIn} onClick={google.start}>
                Switch Google account
              </Button>
            </p>
          </>
        );
        break;
      }
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>{content}</div>
    </div>
  );
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.heading}>
      <h1 className={page.title}>{title}</h1>
      <p className={page.bodyText}>{children}</p>
    </div>
  );
}
