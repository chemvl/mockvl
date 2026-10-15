import type { CSSProperties, ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "error" | "active";

const tones: Record<StatusTone, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  error: "var(--error)",
  active: "var(--accent-teal)",
};

export function StatusDot({ tone = "ok", label, style }: { tone?: StatusTone; label?: ReactNode; style?: CSSProperties }) {
  const dot = (
    <span
      style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: tones[tone], display: "inline-block" }}
    />
  );
  if (!label) return dot;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: "400 13px/1.4 var(--font-sans)",
        color: tone === "warn" ? "var(--warning-text)" : "var(--body)",
        ...style,
      }}
    >
      {dot}
      {label}
    </span>
  );
}
