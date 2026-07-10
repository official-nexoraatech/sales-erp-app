# syntax=docker/dockerfile:1
# Multi-stage build for inventory-service

# ─── Stage 1: Dependencies ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/db-client/package.json ./packages/db-client/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/platform-sdk/package.json ./packages/platform-sdk/
COPY apps/inventory-service/package.json ./apps/inventory-service/

RUN pnpm install --frozen-lockfile --filter @erp/inventory-service...

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
COPY --from=deps /app/apps/inventory-service/node_modules ./apps/inventory-service/node_modules

COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/inventory-service/ ./apps/inventory-service/

RUN pnpm --filter @erp/types build  && pnpm --filter @erp/config build  && pnpm --filter @erp/logger build  && pnpm --filter @erp/utils build  && pnpm --filter @erp/db build  && pnpm --filter @erp/sdk build  && pnpm --filter @erp/inventory-service build

# ─── Stage 3: Production ─────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S erp  && adduser -S erp -u 1001 -G erp

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
COPY --from=builder --chown=erp:erp /app/apps/inventory-service/package.json ./apps/inventory-service/package.json
COPY --from=builder --chown=erp:erp /app/apps/inventory-service/dist ./apps/inventory-service/dist
COPY --from=builder --chown=erp:erp /app/apps/inventory-service/node_modules ./apps/inventory-service/node_modules

USER erp

EXPOSE 3012

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3   CMD wget -qO- http://localhost:3012/health || exit 1

CMD ["node", "apps/inventory-service/dist/main.js"]
