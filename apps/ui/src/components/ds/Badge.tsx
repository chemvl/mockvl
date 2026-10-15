import type { CSSProperties, ReactNode } from "react";

export type BadgeVariant = "pill" | "meta" | "coral" | "canvas";

const looks: Record<BadgeVariant, CSSProperties> = {
  pill: { background: "var(--surface-card)", color: "var(--ink)", font: "500 13px/1.4 var(--font-sans)", padding: "4px 12px" },
  meta: {
    background: "var(--surface-card)",
    color: "var(--ink)",
    font: "500 12px/20px var(--font-sans)",
    padding: "0 10px",
    maxWidth: 170,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  coral: {
    background: "var(--primary)",
    color: "var(--on-primary)",
    font: "500 12px/1.4 var(--font-sans)",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    padding: "4px 12px",
  },
  canvas: { background: "var(--canvas)", color: "var(--ink)", font: "500 12px/20px var(--font-sans)", padding: "0 10px" },
};

export function Badge({ variant = "pill", children, style }: { variant?: BadgeVariant; children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{ display: "inline-block", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap", ...looks[variant], ...style }}
    >
      {children}
    </span>
  );
}
