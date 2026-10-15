// Google Identity Services, OAuth 2.0 code model (popup). Docs:
// https://developers.google.com/identity/oauth2/web/guides/use-code-model
const GIS_SRC = "https://accounts.google.com/gsi/client";

export type CodeResponse = { code?: string; error?: string; error_description?: string };
export type CodeClientConfig = {
  client_id: string;
  scope: string;
  ux_mode: "popup";
  hd?: string;
  select_account?: boolean;
  login_hint?: string;
  callback: (response: CodeResponse) => void;
  error_callback?: (error: { type: string }) => void;
};
export type CodeClient = { requestCode: () => void };
export type GoogleOAuth2 = { initCodeClient: (config: CodeClientConfig) => CodeClient };

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

let loading: Promise<GoogleOAuth2> | null = null;

export function loadGis(): Promise<GoogleOAuth2> {
  loading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error("Google Identity Services did not initialize"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Google Identity Services"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
