import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.scss";

type ModalProps = {
  title: ReactNode;
  onClose: () => void;
  actions: ReactNode;
  children: ReactNode;
  width?: number;
};

// Mount conditionally: {open && <Modal …/>}. Buttons go in `actions`, Cancel first.
export function Modal({ title, onClose, actions, children, width = 440 }: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  // Captured during the first render: React's autoFocus runs at commit, before effects.
  const [returnFocus] = useState(() => document.activeElement);

  useEffect(() => {
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      (card.querySelector<HTMLElement>("[autofocus]") ?? card).focus();
    }
    return () => {
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={styles.card}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>
        {children}
        <div className={styles.actions}>{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
