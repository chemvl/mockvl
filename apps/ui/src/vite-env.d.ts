/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_API_ENDPOINT?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_HD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
