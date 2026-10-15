import { type ButtonHTMLAttributes, type CSSProperties, useState } from "react";

export type ButtonVariant = "primary" | "secondary" | "on-dark" | "on-coral" | "text" | "link" | "link-muted";
export type ButtonSize = "md" | "panel" | "sm";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  style?: CSSProperties;
};

const base: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius-md)",
  font: "var(--type-button)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

const sizes: Record<ButtonSize, CSSProperties> = {
  md: { minHeight: 40, padding: "0 20px" },
  panel: { minHeight: 36, padding: "0 16px" },
  sm: { minHeight: 30, padding: "0 12px", borderRadius: "var(--radius-sm)", fontSize: 13 },
};

function look(variant: ButtonVariant, pressed: boolean, disabled: boolean): CSSProperties {
  switch (variant) {
    case "primary":
      if (disabled) {
        return { background: "var(--primary-disabled)", borderColor: "var(--primary-disabled)", color: "var(--muted)" };
      }
      return {
        background: pressed ? "var(--primary-active)" : "var(--primary)",
        borderColor: pressed ? "var(--primary-active)" : "var(--primary)",
        color: "var(--on-primary)",
      };
    case "on-dark":
      return {
        background: "var(--surface-dark-elevated)",
        borderColor: "var(--surface-dark-elevated)",
        color: disabled ? "var(--on-dark-soft)" : "var(--on-dark)",
      };
    case "on-coral":
      return {
        background: pressed ? "var(--surface-card)" : "var(--canvas)",
        borderColor: "var(--canvas)",
        color: "var(--ink)",
      };
    case "text":
      return { background: "transparent", border: 0, padding: "0 4px", color: disabled ? "var(--muted)" : "var(--ink)" };
    case "link":
      return {
        background: "none",
        border: 0,
        padding: "0 2px",
        minHeight: 0,
        fontSize: 13,
        color: "var(--primary)",
        textDecoration: pressed ? "underline" : "none",
      };
    case "link-muted":
      return {
        background: "none",
        border: 0,
        padding: "0 2px",
        minHeight: 0,
        fontSize: 13,
        color: "var(--muted)",
        textDecoration: pressed ? "underline" : "none",
      };
    default:
      return {
        background: pressed && !disabled ? "var(--surface-card)" : "var(--canvas)",
        color: disabled ? "var(--muted)" : "var(--ink)",
      };
  }
}

export function Button({
  variant = "secondary",
  size = "md",
  disabled = false,
  fullWidth = false,
  type = "button",
  children,
  style,
  ...rest
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const s: CSSProperties = {
    ...base,
    ...sizes[size],
    ...look(variant, pressed && !disabled, disabled),
    cursor: disabled ? "default" : "pointer",
    width: fullWidth ? "100%" : undefined,
    ...style,
  };
  return (
    <button
      type={type}
      disabled={disabled}
      style={s}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      {...rest}
    >
      {children}
    </button>
  );
}
