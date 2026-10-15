import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { loginWithGoogleCodeMutation } from "@/client/@tanstack/react-query.gen";
import { uiEnv } from "@/config/env";
import { errorMessage } from "@/lib/api/errors";
import { type CodeClient, loadGis } from "./gis";
import { setSession } from "./token-store";

const NOT_CONFIGURED = "Google sign-in isn't configured. Set VITE_GOOGLE_CLIENT_ID and reload.";

type GoogleSignInOptions = {
  /** Always show Google's account chooser (`select_account`), for switching accounts. */
  selectAccount?: boolean;
  /** Preselects this account in Google's chooser. */
  loginHint?: string;
  /** Runs after the new session is stored and the query cache is cleared. */
  onSignedIn: () => void;
};

export type GoogleSignIn = {
  /** Opens the Google popup. Call it synchronously inside a click handler. */
  start: () => void;
  ready: boolean;
  signingIn: boolean;
  error: string | null;
};

/** Google sign-in (GIS code model, popup) followed by the API code exchange. */
export function useGoogleSignIn({ selectAccount = false, loginHint, onSignedIn }: GoogleSignInOptions): GoogleSignIn {
  const queryClient = useQueryClient();
  const [codeClient, setCodeClient] = useState<CodeClient | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: exchangeCode } = useMutation({
    ...loginWithGoogleCodeMutation(),
    onSuccess: (result) => {
      setSession(result.data);
      queryClient.clear();
      setSigningIn(false);
      onSignedIn();
    },
    onError: (failure) => {
      setSigningIn(false);
      setError(errorMessage(failure));
    },
  });

  // Load GIS and build the code client up front: requestCode() must run
  // synchronously inside the click, or browsers block the popup.
  useEffect(() => {
    if (!uiEnv.googleClientId) return;
    let cancelled = false;
    loadGis().then(
      (oauth2) => {
        if (cancelled) return;
        setCodeClient(
          oauth2.initCodeClient({
            client_id: uiEnv.googleClientId,
            scope: "openid email profile",
            ux_mode: "popup",
            ...(uiEnv.googleHd ? { hd: uiEnv.googleHd } : {}),
            ...(selectAccount ? { select_account: true } : {}),
            ...(loginHint ? { login_hint: loginHint } : {}),
            callback: (response) => {
              if (!response.code) {
                setSigningIn(false);
                setError("Google sign-in was cancelled. Try again.");
                return;
              }
              exchangeCode({ body: { code: response.code }, headers: { "X-Requested-With": "XMLHttpRequest" } });
            },
            error_callback: () => setSigningIn(false),
          }),
        );
      },
      () => {
        if (!cancelled) setError("Couldn't load Google sign-in. Check your connection and reload.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [exchangeCode, selectAccount, loginHint]);

  return {
    start: () => {
      if (!codeClient) return;
      setError(null);
      setSigningIn(true);
      codeClient.requestCode();
    },
    ready: codeClient !== null,
    signingIn,
    error: uiEnv.googleClientId ? error : NOT_CONFIGURED,
  };
}
