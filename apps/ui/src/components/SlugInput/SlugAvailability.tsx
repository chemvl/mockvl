import { StatusDot } from "@/components/ds";
import type { SlugCheck } from "@/features/mocks/use-slug-availability";
import { SLUG_INVALID_MESSAGE } from "@/lib/slug";
import { WORKSPACE_SLUG_INVALID_MESSAGE } from "@/lib/workspace-slug";
import styles from "./SlugAvailability.module.scss";

function availabilityLabel(check: SlugCheck, kind: "mock" | "workspace") {
  const slug = <span className={styles.slug}>{check.slug}</span>;
  switch (check.state) {
    case "available":
      return <StatusDot tone="ok" label={<>{slug} is available</>} />;
    case "taken":
      return <StatusDot tone="error" label={<>{slug} is already taken</>} />;
    case "reserved":
      return (
        <StatusDot
          tone="error"
          label={kind === "workspace" ? <>{slug} is reserved</> : <>{slug} is reserved. Choose another slug.</>}
        />
      );
    case "invalid":
      return (
        <StatusDot tone="error" label={kind === "workspace" ? WORKSPACE_SLUG_INVALID_MESSAGE : SLUG_INVALID_MESSAGE} />
      );
    default:
      return null;
  }
}

/** Always occupies one status line, so idle/checking ↔ result never shifts the layout while typing. */
export function SlugAvailability({ check, kind = "mock" }: { check: SlugCheck; kind?: "mock" | "workspace" }) {
  return <div className={styles.line}>{availabilityLabel(check, kind)}</div>;
}
