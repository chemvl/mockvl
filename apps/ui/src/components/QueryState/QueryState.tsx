import { Button, Notice } from "@/components/ds";
import { errorMessage } from "@/lib/api/errors";
import styles from "./QueryState.module.scss";

export function LoadingState({ label }: { label: string }) {
  return <p className={styles.loading}>{label}</p>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Notice kind="error">
      {errorMessage(error)}{" "}
      <Button variant="link" onClick={onRetry}>
        Try again
      </Button>
    </Notice>
  );
}
