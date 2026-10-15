import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { logout } from "@/client/sdk.gen";
import { clearSession, getRefreshToken } from "./token-store";

export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await logout({ body: { refreshToken }, throwOnError: true });
      } catch {
        // The local session is cleared either way; the server revocation is best effort.
      }
    }
    clearSession();
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [navigate, queryClient]);
}
