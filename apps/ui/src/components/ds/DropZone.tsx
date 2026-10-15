import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type DropZoneProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "style"> & {
  title?: ReactNode;
  hint?: ReactNode;
  active?: boolean;
  style?: CSSProperties;
};

export function DropZone({ title = "Drop files here", hint, active = false, onKeyDown, style, ...rest }: DropZoneProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        textAlign: "center",
        padding: "28px 16px",
        border: `2px dashed ${active ? "var(--primary)" : "var(--hairline)"}`,
        borderRadius: "var(--radius-lg)",
        background: active ? "var(--primary-tint)" : "var(--surface-soft)",
        color: "var(--muted)",
        font: "400 13px/1.55 var(--font-sans)",
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      <strong style={{ font: "400 18px/1.2 var(--font-display)", letterSpacing: "-0.2px", color: "var(--ink)" }}>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}
