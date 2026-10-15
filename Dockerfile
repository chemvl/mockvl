# Build from the REPO ROOT:
#   docker build -f Dockerfile .
#
# Stages:
#   deps      — full workspace install (dev deps included) with a frozen lockfile
#   check     — typecheck + lint + unit tests; never shipped (.github/workflows/ci.yml builds this target):
#               docker build -f Dockerfile --target check .
#   prod-deps — production node_modules for the API workspace only
#   runtime   — slim image, non-root user, runs the API directly with bun

# ---- deps ----------------------------------------------------------------
FROM oven/bun:1.4-slim AS deps
WORKDIR /app

# Manifests + lockfile only, so source edits don't bust the install cache.
# Every workspace manifest must be present or the frozen install fails.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/docs/package.json apps/docs/
COPY apps/ui/package.json apps/ui/
COPY packages/config/package.json packages/config/
COPY packages/schemas/package.json packages/schemas/
RUN bun install --frozen-lockfile

# ---- check ---------------------------------------------------------------
FROM deps AS check
COPY biome.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# API-scoped checks only: this image ships just the API, and the stage has no
# Postgres (unit tests only — integration/e2e run in CI against a real
# database, outside docker) and no apps/docs (the root typecheck/lint scripts
# cover it, so they can't run here).
RUN bun run --cwd apps/api typecheck && bunx biome check apps/api packages && bun test apps/api/tests/unit

# ---- prod-deps -----------------------------------------------------------
FROM oven/bun:1.4-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/docs/package.json apps/docs/
COPY apps/ui/package.json apps/ui/
COPY packages/config/package.json packages/config/
COPY packages/schemas/package.json packages/schemas/
# --filter: only the API's (and its workspace deps') production packages — the
# admin/ui/docs dependency trees are ~10x the files and never run in this image.
RUN bun install --frozen-lockfile --production --filter @starter/api

# ---- runtime -------------------------------------------------------------
FROM oven/bun:1.4-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Whole prepared tree: node_modules symlinks workspace packages by relative
# path, so the directory layout must match the install stage exactly.
COPY --from=prod-deps /app /app

# Bun runs TypeScript directly; tsconfigs are needed at runtime for the
# `@/*` path alias, and packages/schemas ships as source.
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY packages/config packages/config
COPY packages/schemas packages/schemas

# The oven/bun base image ships an unprivileged `bun` user.
USER bun
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["bun", "run", "src/index.ts"]
