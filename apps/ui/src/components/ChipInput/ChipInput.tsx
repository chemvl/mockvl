import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { Badge } from "@/components/ds";
import styles from "./ChipInput.module.scss";

export type Chip = { email: string; valid: boolean };

type ChipInputProps = {
  chips: readonly Chip[];
  /** Raw, un-normalized values; the owner trims, lowercases and de-duplicates. */
  onAdd: (raw: string[]) => void;
  onRemove: (index: number) => void;
  placeholder: string;
  ariaLabel: string;
  describedBy?: string;
  autoFocus?: boolean;
};

const SEPARATORS = /[\s,;]+/;
// Meta badge, but wide enough for an email plus its ✕ (the badge's 170px cap would clip the button).
const CHIP_LOOK: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" };
const INVALID_LOOK: CSSProperties = { background: "var(--error-soft)", color: "var(--error-text)" };

export function ChipInput({ chips, onAdd, onRemove, placeholder, ariaLabel, describedBy, autoFocus }: ChipInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  function commit(raw: string) {
    const parts = raw.split(SEPARATORS).filter((part) => part !== "");
    if (parts.length > 0) onAdd(parts);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "," || event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (text.trim() === "") return;
      commit(text);
      setText("");
    } else if (event.key === "Backspace" && text === "" && chips.length > 0) {
      onRemove(chips.length - 1);
    }
  }

  return (
    <div className={styles.field}>
      {chips.map((chip, index) => (
        <Badge key={chip.email} variant="meta" style={{ ...CHIP_LOOK, ...(chip.valid ? null : INVALID_LOOK) }}>
          <span className={styles.email}>{chip.email}</span>
          <button
            type="button"
            className={styles.remove}
            aria-label={`Remove ${chip.email}`}
            onClick={() => {
              onRemove(index);
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        className={styles.input}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        autoComplete="off"
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          commit(event.clipboardData.getData("text"));
        }}
        onBlur={() => {
          if (text.trim() === "") return;
          commit(text);
          setText("");
        }}
      />
    </div>
  );
}
