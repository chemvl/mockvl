import type { CSSProperties, ReactNode } from "react";

type CodeBlockProps = { children: ReactNode; maxHeight?: number; wrap?: boolean; style?: CSSProperties };

export function CodeBlock({ children, maxHeight = 320, wrap = true, style }: CodeBlockProps) {
  return (
    <pre
      style={{
        margin: 0,
        maxHeight,
        overflow: "auto",
        padding: "12px 14px",
        background: "var(--code-bg)",
        color: "var(--code-text)",
        border: "1px solid var(--code-border)",
        borderRadius: "var(--radius-lg)",
        font: "400 12px/1.6 var(--font-mono)",
        whiteSpace: wrap ? "pre-wrap" : "pre",
        wordBreak: wrap ? "break-word" : "normal",
        ...style,
      }}
    >
      {children}
    </pre>
  );
}
