import type { CSSProperties, ReactNode } from "react";

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

type TabsProps<T extends string> = {
  items: ReadonlyArray<T | TabItem<T>>;
  value: T;
  onChange?: (value: T) => void;
  size?: "md" | "sm";
  style?: CSSProperties;
};

function Count({ children, onCard = false }: { children: ReactNode; onCard?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 20,
        padding: "0 7px",
        borderRadius: "var(--radius-pill)",
        background: onCard ? "var(--canvas)" : "var(--surface-card)",
        color: "var(--ink)",
        font: "500 12px/18px var(--font-sans)",
        textAlign: "center",
        marginLeft: 6,
      }}
    >
      {children}
    </span>
  );
}

export function Tabs<T extends string>({ items, value, onChange, size = "md", style }: TabsProps<T>) {
  const pad = size === "sm" ? "4px 10px" : "8px 14px";
  const fs = size === "sm" ? 13 : 14;
  return (
    <nav role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 4, ...style }}>
      {items.map((it) => {
        const item: TabItem<T> = typeof it === "string" ? { value: it, label: it } : it;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: pad,
              border: 0,
              borderRadius: "var(--radius-md)",
              background: active ? "var(--surface-card)" : "transparent",
              color: active ? "var(--ink)" : "var(--muted)",
              font: `500 ${fs}px/1.4 var(--font-sans)`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
            {item.count ? <Count onCard={active}>{item.count}</Count> : null}
          </button>
        );
      })}
    </nav>
  );
}
