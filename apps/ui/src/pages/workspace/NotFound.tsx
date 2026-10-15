import { useNavigate } from "react-router";
import { Button } from "@/components/ds";
import { brand } from "@/config/brand";
import type { Workspace } from "@/lib/api/types";
import page from "@/styles/page.module.scss";
import styles from "./NotFound.module.scss";

/** Unknown or inaccessible {ws}. Same copy either way, so existence isn't revealed. */
export function WorkspaceNotFound({ workspaces }: { workspaces: readonly Workspace[] }) {
  const navigate = useNavigate();
  const target = workspaces[0];
  return (
    <div className={styles.box}>
      <h1 className={page.title}>Workspace not found</h1>
      <p className={page.bodyText}>It may have been deleted, or you're not a member.</p>
      <Button variant="primary" onClick={() => navigate(target ? `/${target.slug}` : "/")}>
        {target ? `Go to ${target.name}` : `Go to ${brand.name}`}
      </Button>
    </div>
  );
}

export function NotFoundContent() {
  const navigate = useNavigate();
  return (
    <div className={styles.box}>
      <h1 className={page.title}>Page not found</h1>
      <p className={page.bodyText}>This page doesn't exist, or you don't have access to it.</p>
      <Button onClick={() => navigate("/")}>Go to your workspace</Button>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className={styles.center}>
      <NotFoundContent />
    </div>
  );
}
