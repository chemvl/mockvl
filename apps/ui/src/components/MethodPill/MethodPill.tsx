import styles from "./MethodPill.module.scss";

const tints: Record<string, string | undefined> = {
  get: styles.get,
  post: styles.post,
  put: styles.amber,
  patch: styles.amber,
  delete: styles.delete,
};

export function MethodPill({ method }: { method: string }) {
  const tint = tints[method.toLowerCase()] ?? styles.other;
  return <span className={`${styles.pill} ${tint}`}>{method.toUpperCase()}</span>;
}
