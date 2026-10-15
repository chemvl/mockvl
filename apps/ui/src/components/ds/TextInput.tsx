import { type CSSProperties, type InputHTMLAttributes, useState } from "react";

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "style"> & {
  size?: "md" | "sm";
  invalid?: boolean;
  style?: CSSProperties;
};

export function TextInput({ size = "md", invalid = false, style, onFocus, onBlur, ...rest }: TextInputProps) {
  const [focus, setFocus] = useState(false);
  const s: CSSProperties = {
    height: 40,
    padding: "0 14px",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--radius-md)",
    background: "var(--canvas)",
    color: "var(--ink)",
    font: "var(--type-body-md)",
    outline: "none",
    ...(size === "sm" ? { height: 32, padding: "0 10px", fontSize: 13 } : null),
    ...(focus ? { borderColor: "var(--primary)", boxShadow: "0 0 0 3px var(--primary-ring)" } : null),
    ...(invalid ? { borderColor: "var(--error)" } : null),
    ...style,
  };
  return (
    <input
      style={s}
      onFocus={(event) => {
        setFocus(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocus(false);
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}
