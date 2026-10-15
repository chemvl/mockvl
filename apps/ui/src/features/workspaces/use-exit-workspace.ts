import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { listWorkspacesOptions } from "@/client/@tanstack/react-query.gen";
import { useToast } from "@/components/Toast/toast-context";
import { forgetWorkspace } from "@/lib/api/cache";
import type { Workspace } from "@/lib/api/types";

/** After leaving or deleting `ws`: drop its cache, refresh the list and land on the next workspace. */
export function useExitWorkspace(): (ws: Workspace, toastText: string) => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  return useCallback(
    async (ws: Workspace, toastText: string) => {
      forgetWorkspace(queryClient, ws.slug);
      // The exit already happened server-side; if the refresh fails, "/" redirects once the list loads.
      const next = await queryClient.fetchQuery({ ...listWorkspacesOptions(), staleTime: 0 }).then(
        (result) => result.data[0],
        () => undefined,
      );
      navigate(next ? `/${next.slug}` : "/", { replace: true });
      toast(toastText);
    },
    [queryClient, navigate, toast],
  );
}
