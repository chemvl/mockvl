import { formatInitials, formatNameInitials } from "@/lib/format";
import styles from "./Avatar.module.scss";

type AvatarProps = { name: string | null; email: string; src?: string | null; size: 28 | 32 };

/** Initials circle, or the Google photo when `src` is set. Decorative: the name/email sits next to it. */
export function Avatar({ name, email, src, size }: AvatarProps) {
  const initials = (name && formatNameInitials(name)) || formatInitials(email);
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      {src ? <img className={styles.photo} src={src} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
}
