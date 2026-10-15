import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./AppHeader.module.scss";

type HeaderDropdownProps = {
  label: ReactNode;
  buttonClassName: string;
  ariaLabel?: string;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
};

// One anchor wraps trigger + menu so an outside-click closes it and a trigger
// click toggles it without reopening.
export function HeaderDropdown({ label, buttonClassName, ariaLabel, align = "start", children }: HeaderDropdownProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={anchor} className={styles.anchor}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div role="menu" className={`${styles.menu} ${align === "end" ? styles.menuEnd : ""}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function HeaderMenuItem({
  selected = false,
  onSelect,
  children,
}: {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.menuItem} ${selected ? styles.menuItemSelected : ""}`}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
