# apps/web image: builds the Next.js 16 static export (output: 'export') and serves it with
# Caddy, which also reverse-proxies /api/* to the api service (docs/product/ARCHITECTURE.md §1
# D4 "same-origin deployment").
#
# Build context must be the repo root (not deploy/) because this is a pnpm workspace: apps/web
# depends on packages/core and packages/ui via "workspace:*".
FROM node:24-slim AS build

# NEXT_PUBLIC_API_BASE_URL is read at Next.js build time. "" (default) means same-origin: the
# SPA calls /api/... and Caddy proxies it to the api service, so no value is normally needed.
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core packages/core
COPY packages/ui packages/ui
COPY apps/web apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/out /srv
