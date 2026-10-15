import type { CSSProperties, ReactNode } from "react";

export type NoticeKind = "info" | "warning" | "error";

const looks: Record<NoticeKind, CSSProperties> = {
  error: { background: "var(--error-soft)", color: "var(--error-text)" },
  info: { background: "var(--surface-card)", color: "var(--ink)" },
  warning: { background: "var(--warning-soft)", color: "var(--warning-text)" },
};

type NoticeProps = { kind?: NoticeKind; children: ReactNode; onDismiss?: () => void; style?: CSSProperties };

export function Notice({ kind = "info", children, onDismiss, style }: NoticeProps) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        font: "400 13px/1.55 var(--font-sans)",
        ...looks[kind],
        ...style,
      }}
    >
      <span>{children}</span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            border: 0,
            background: "none",
            padding: "0 2px",
            color: "inherit",
            font: "500 13px/1.55 var(--font-sans)",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
