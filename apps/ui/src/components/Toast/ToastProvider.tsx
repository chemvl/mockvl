import { type ReactNode, useCallback, useEffect, useState } from "react";
import styles from "./Toast.module.scss";
import { ToastContext } from "./toast-context";

const TOAST_MS = 1800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const show = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.id} role="status" className={styles.toast}>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}
