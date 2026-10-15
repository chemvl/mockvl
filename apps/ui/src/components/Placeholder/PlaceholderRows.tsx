import styles from "./PlaceholderRows.module.scss";

/** Loading placeholder: static bars, no shimmer. */
export function PlaceholderRows({ count }: { count: number }) {
  return (
    <div className={styles.rows} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => `row-${index}`).map((id) => (
        <span key={id} className={styles.bar} />
      ))}
    </div>
  );
}
