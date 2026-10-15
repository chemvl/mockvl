# @starter/ui — Mockvl web app

Vite 8 + React 19 SPA for hosted Prism mock servers.

## Develop

```console
cp .env.example .env          # set VITE_GOOGLE_CLIENT_ID (and VITE_GOOGLE_HD if the API sets APP_GOOGLE_ALLOWED_HD)
bun run --cwd apps/ui dev     # http://localhost:5173, proxies /api and /m to VITE_APP_API_ENDPOINT
```

## Regenerate the API client

```console
bun run openapi:dump               # repo root: writes apps/ui/openapi.json (no DB/Redis needed)
bun run --cwd apps/ui openapi-ts   # writes src/client (committed)
```

## Check

```console
bun run --cwd apps/ui lint
bun run --cwd apps/ui build
```

Dark theme: add `theme-dark` to `<html>` (`document.documentElement.classList.add("theme-dark")`).
