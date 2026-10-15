// Base URL of the starter API (apps/api) — the admin realm. Distinct from the
// legacy product backend the generated hey-api client talks to (/api/app).
// Includes the API base path (API_BASE_PATH in apps/api, default /api); keep
// the two in sync when overriding via VITE_ADMIN_API_URL.
export const ADMIN_API_URL: string =
  import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:3000/api';

// Router basename. The deployed single-domain layout serves this SPA under
// /admin (the reverse proxy must rewrite /admin/* to index.html), so production
// builds must set VITE_ADMIN_BASENAME=/admin; local dev serves from '/'.
export const ADMIN_BASENAME: string =
  import.meta.env.VITE_ADMIN_BASENAME ?? '/';
