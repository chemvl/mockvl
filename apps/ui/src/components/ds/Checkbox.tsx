import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "style"> & {
  label?: ReactNode;
  type?: "checkbox" | "radio";
  style?: CSSProperties;
};

export function Checkbox({ label, type = "checkbox", style, ...rest }: CheckboxProps) {
  const box = <input type={type} style={{ accentColor: "var(--primary)", width: 16, height: 16, margin: 0 }} {...rest} />;
  if (!label) return box;
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        font: "400 13px/1.4 var(--font-sans)",
        color: "var(--body)",
        ...style,
      }}
    >
      {box}
      {label}
    </label>
  );
}
