import { useState } from "react";
import styles from "./SlugInput.module.scss";

type SlugInputProps = {
  /** Fixed, non-editable prefix, e.g. "app.example.com/m/platform/". */
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  id?: string;
  maxLength?: number;
  ariaLabel?: string;
};

export function SlugInput({
  prefix,
  value,
  onChange,
  invalid = false,
  id,
  maxLength = 40,
  ariaLabel = "Slug",
}: SlugInputProps) {
  const [focus, setFocus] = useState(false);
  const className = [styles.field, focus ? styles.focus : "", invalid ? styles.invalid : ""].join(" ");
  return (
    <div className={className}>
      <span className={styles.prefix} title={prefix}>
        {prefix}
      </span>
      <input
        id={id}
        className={styles.input}
        value={value}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
    </div>
  );
}
