import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listMockOverridesQueryKey, resetMockOverrideMutation } from "@/client/@tanstack/react-query.gen";
import { Button, Notice } from "@/components/ds";
import { Modal } from "@/components/Modal/Modal";
import { errorMessage } from "@/lib/api/errors";
import type { OperationSummary } from "@/lib/api/types";
import page from "@/styles/page.module.scss";

type ResetOverrideModalProps = {
  ws: string;
  slug: string;
  method: OperationSummary["method"];
  path: string;
  code: number;
  custom: boolean;
  onClose: () => void;
  /** After the saved response is deleted (the caller re-sends). */
  onReset: () => void;
};

export function ResetOverrideModal({ ws, slug, method, path, code, custom, onClose, onReset }: ResetOverrideModalProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    ...resetMockOverrideMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listMockOverridesQueryKey({ path: { ws, slug } }) });
      onReset();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Modal
      title={
        <>
          Reset{" "}
          <span className={page.mono}>
            {method.toUpperCase()} {path} {code}
          </span>{" "}
          to the {custom ? "default" : "schema"} response?
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={reset.isPending}
            onClick={() => reset.mutate({ path: { ws, slug }, query: { method, path, code } })}
          >
            {reset.isPending ? "Resetting…" : "Reset response"}
          </Button>
        </>
      }
    >
      <p className={page.bodyText}>Your edited JSON is deleted.</p>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
