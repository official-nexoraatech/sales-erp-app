# syntax=docker/dockerfile:1
# Multi-stage build for report-service

# ─── Stage 1: Dependencies ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm@9.15.0

# Puppeteer's bundled Chromium download doesn't run on Alpine's musl libc —
# system chromium (installed in the production stage below) is used instead.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/db-client/package.json ./packages/db-client/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/platform-sdk/package.json ./packages/platform-sdk/
COPY apps/report-service/package.json ./apps/report-service/

RUN pnpm install --frozen-lockfile --filter @erp/report-service...

# ─── Stage 2: Build ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/logger/node_modules ./packages/logger/node_modules
COPY --from=deps /app/packages/db-client/node_modules ./packages/db-client/node_modules
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules
COPY --from=deps /app/packages/platform-sdk/node_modules ./packages/platform-sdk/node_modules
COPY --from=deps /app/apps/report-service/node_modules ./apps/report-service/node_modules

COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/report-service/ ./apps/report-service/

RUN pnpm --filter @erp/types build \
 && pnpm --filter @erp/config build \
 && pnpm --filter @erp/logger build \
 && pnpm --filter @erp/utils build \
 && pnpm --filter @erp/db build \
 && pnpm --filter @erp/sdk build \
 && pnpm --filter @erp/report-service build

# ─── Stage 3: Production ─────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# System Chromium + fonts/libs Puppeteer needs to render PDFs on Alpine (musl) —
# the npm `puppeteer` package's own bundled Chromium download is glibc-only.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup -g 1001 -S erp \
 && adduser -S erp -u 1001 -G erp

COPY --from=builder --chown=erp:erp /app/node_modules ./node_modules
COPY --from=builder --chown=erp:erp /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=erp:erp /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder --chown=erp:erp /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=builder --chown=erp:erp /app/packages/config/package.json ./packages/config/package.json
COPY --from=builder --chown=erp:erp /app/packages/config/dist ./packages/config/dist
COPY --from=builder --chown=erp:erp /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=builder --chown=erp:erp /app/packages/logger/package.json ./packages/logger/package.json
COPY --from=builder --chown=erp:erp /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder --chown=erp:erp /app/packages/logger/node_modules ./packages/logger/node_modules
COPY --from=builder --chown=erp:erp /app/packages/db-client/package.json ./packages/db-client/package.json
COPY --from=builder --chown=erp:erp /app/packages/db-client/dist ./packages/db-client/dist
COPY --from=builder --chown=erp:erp /app/packages/db-client/node_modules ./packages/db-client/node_modules
COPY --from=builder --chown=erp:erp /app/packages/shared-utils/package.json ./packages/shared-utils/package.json
COPY --from=builder --chown=erp:erp /app/packages/shared-utils/dist ./packages/shared-utils/dist
COPY --from=builder --chown=erp:erp /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules
COPY --from=builder --chown=erp:erp /app/packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY --from=builder --chown=erp:erp /app/packages/platform-sdk/dist ./packages/platform-sdk/dist
COPY --from=builder --chown=erp:erp /app/packages/platform-sdk/node_modules ./packages/platform-sdk/node_modules
COPY --from=builder --chown=erp:erp /app/apps/report-service/package.json ./apps/report-service/package.json
COPY --from=builder --chown=erp:erp /app/apps/report-service/dist ./apps/report-service/dist
COPY --from=builder --chown=erp:erp /app/apps/report-service/node_modules ./apps/report-service/node_modules

USER erp

EXPOSE 3015

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3015/health || exit 1

CMD ["node", "apps/report-service/dist/main.js"]
