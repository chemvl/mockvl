import { formatNameInitials } from "@/lib/format";
import styles from "./WorkspaceTile.module.scss";

/** Initials tile for a workspace. Decorative: the name sits next to it. */
export function WorkspaceTile({ name, size }: { name: string; size: 28 | 40 }) {
  return (
    <span className={`${styles.tile} ${size === 40 ? styles.large : styles.small}`} aria-hidden="true">
      {formatNameInitials(name)}
    </span>
  );
}
