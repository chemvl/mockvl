import { useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { hasSession, subscribeSession } from "./token-store";

export function RequireAuth() {
  const signedIn = useSyncExternalStore(subscribeSession, hasSession);
  const location = useLocation();
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
