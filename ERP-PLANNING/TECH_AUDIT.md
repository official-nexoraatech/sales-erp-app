# NEXORAA ERP — Complete Technology Audit
## Generated: 2026-06-30 | Audited by: Claude Sonnet 4.6

> **This document is the authoritative technology reference for every Claude session.**
> Read this at the start of any new session before suggesting a new library, service, or infrastructure component.
> Everything listed here is already installed and wired. Do NOT add duplicates.

---

## 1. Programming Languages

| Language | Approx. % | Where Used |
|----------|-----------|------------|
| **TypeScript** | ~92% | All backend services, packages, and frontends |
| **SQL** | ~4% | Drizzle migration files (`packages/db-client/migrations/`) |
| **HTML** (via TSX) | ~2% | React components, Handlebars PDF templates |
| **CSS** (via Tailwind) | ~1% | Frontend styling utility classes |
| **YAML** | ~1% | `docker-compose.yml`, GitHub Actions workflows |
| **Bash** | <1% | Docker healthcheck commands, CI scripts |

- **Node.js** runtime ≥ 20.0.0 (required by all backend services and `engines` field in root `package.json`)
- TypeScript strict mode enforced (`"strict": true` in `tsconfig.base.json`)
- All packages use `"type": "module"` (pure ESM)

---

## 2. Frontend Stack

### Two Frontend Applications

| App | Package Name | Port | Purpose |
|-----|-------------|------|---------|
| `apps/web-frontend` | `@erp/web-frontend` | 5173 (Vite default) | ERP admin / management interface |
| `apps/pos-frontend` | `@erp/pos-frontend` | 5174 (Vite default) | Point of Sale terminal interface |

### Framework & Core
| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | ^19.0.0 | UI framework |
| **React DOM** | ^19.0.0 | DOM renderer |
| **Vite** | ^6.0.5 | Dev server + build tool |
| **@vitejs/plugin-react** | ^4.3.4 | React Fast Refresh + JSX transform |
| **TypeScript** | ^5.7.3 | Type checking |

### Routing
| Technology | Version | Purpose |
|-----------|---------|---------|
| **react-router-dom** | ^7.0.2 | Client-side routing (v7 — not v6) |

> **IMPORTANT:** Using React Router v7, not v6. API differs from older versions.

### State Management
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Zustand** | ^5.0.2 | Global client state (auth store with `persist` middleware) |
| **TanStack Query** | ^5.62.16 | Server state, data fetching, caching |

> Auth state is persisted to localStorage via `zustand/middleware persist`.

### Forms & Validation
| Technology | Version | Purpose |
|-----------|---------|---------|
| **react-hook-form** | ^7.54.2 | Form state management |
| **@hookform/resolvers** | ^3.9.1 | Zod schema integration for forms |
| **Zod** | ^3.24.0 | Schema validation (shared with backend) |

### CSS & Styling
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Tailwind CSS** | ^4.0.0 | Utility-first CSS framework |
| **@tailwindcss/vite** | ^4.0.0 | Vite plugin for Tailwind v4 |

> **CRITICAL:** Using Tailwind **v4**, NOT v3. Config is in CSS (`@import "tailwindcss"`) — no `tailwind.config.js`.
> Dark mode uses `@custom-variant dark (&:where(.dark, .dark *))` pattern.

### Icons
| Technology | Version | Purpose |
|-----------|---------|---------|
| **lucide-react** | ^0.468.0 | Icon library (SVG icons as React components) |

### Charts
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Recharts** | ^2.15.0 | Data visualization charts (web-frontend only) |

> `pos-frontend` does NOT include Recharts — do not add chart imports there.

### Notifications / Toast
| Technology | Version | Purpose |
|-----------|---------|---------|
| **react-hot-toast** | ^2.4.1 | In-app toast notifications |

### What is NOT used (do not add)
- No Next.js — pure Vite SPA
- No Redux / MobX / Jotai / Recoil
- No Radix UI / shadcn/ui / MUI / Ant Design / Chakra
- No Framer Motion / GSAP
- No Axios (use native `fetch`)
- No i18n library yet
- No Storybook

---

## 3. Backend Stack

### Runtime & Framework
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | ≥20.0.0 | JavaScript runtime |
| **Fastify** | ^4.28.0 | HTTP framework (all 13 backend services) |
| **@fastify/cors** | ^9.0.1 | CORS handling |
| **@fastify/helmet** | ^11.1.1 | HTTP security headers |
| **@fastify/rate-limit** | ^9.1.0 | Rate limiting (auth-service login, api-gateway) |
| **@fastify/http-proxy** | ^9.4.0 | Reverse proxy (api-gateway only) |

> All services use Fastify v4, NOT Express. Do not introduce Express.

### ORM & Database Client
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Drizzle ORM** | ^0.38.3 | Type-safe SQL ORM (all backend services) |
| **drizzle-kit** | ^0.30.1 | Schema migration generator |
| **postgres** | ^3.4.5 | PostgreSQL driver (`postgres.js` — NOT `pg`) |

> Driver is `postgres` (postgres.js), NOT `pg` / `node-postgres`. Import as `import postgres from 'postgres'`.

### Validation
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Zod** | ^3.24.0 | Request body/query validation in all services |

### Authentication & Cryptography
| Technology | Version | Purpose |
|-----------|---------|---------|
| **jose** | ^5.9.6–^5.10.0 | RS256 JWT sign/verify (`importSPKI`, `jwtVerify`, `SignJWT`) |
| **argon2** | ^0.41.1 | Password hashing (Argon2id — auth-service + tenant-service only) |

### Caching & Session
| Technology | Version | Purpose |
|-----------|---------|---------|
| **ioredis** | ^5.4.1 | Redis client (tenant status cache, token cache, distributed locks) |
| **redlock** | ^5.0.0-beta.2 | Distributed lock manager (via `@erp/sdk`) |

### Message Queue & Events
| Technology | Version | Purpose |
|-----------|---------|---------|
| **kafkajs** | ^2.2.4 | Kafka producer/consumer (outbox relay, event consumers) |
| **bullmq** | ^5.34.6 | Job queue (scheduler-service only, backed by Redis) |

### ID Generation
| Technology | Version | Purpose |
|-----------|---------|---------|
| **ulid** | ^2.3.0 | Time-sortable 26-char IDs for `outbox_events.event_id`, `inbox_events.event_id` |

> **CRITICAL:** Use `ulid()` for all `outbox_events.event_id` and `inbox_events.event_id` inserts. The column is `varchar(26)`. Do NOT use `crypto.randomUUID()` (36 chars, overflows the column).

### Templating
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Handlebars** | ^4.7.8 | HTML template engine (notification-service, report-service) |

### PDF Generation
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Puppeteer** | ^23.11.1 | Headless Chrome for PDF generation (report-service only) |

> Puppeteer is initialized non-blocking after server start. `PdfEngine.init()` runs post-`fastify.listen()`.

### Logging
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Winston** | ^3.17.0 | Structured JSON logging (`@erp/logger`) |
| **winston-transport** | ^4.9.0 | Custom transport base class |
| **prom-client** | ^15.1.3 | Prometheus metrics exposure (`/metrics` endpoint) |

> All services use `createLogger({ serviceName, level })` from `@erp/logger`. Do NOT use `console.log`.

### Observability
| Technology | Version | Purpose |
|-----------|---------|---------|
| **@opentelemetry/api** | ^1.9.0 | OTel API (tracing) |
| **@opentelemetry/sdk-node** | ^0.57.0 | OTel Node SDK |
| **@opentelemetry/exporter-trace-otlp-http** | ^0.57.0 | OTLP/HTTP trace exporter → Jaeger |
| **@opentelemetry/resources** | ^1.28.0 | OTel resource definitions |
| **@opentelemetry/semantic-conventions** | ^1.28.0 | Semantic attribute constants |

### Dev Tooling
| Technology | Version | Purpose |
|-----------|---------|---------|
| **tsx** | ^4.19.2 | TypeScript executor for dev (`tsx watch --env-file ../../.env`) |

> Dev command for ALL backend services: `tsx watch --env-file ../../.env src/main.ts`

---

## 4. Database

### PostgreSQL 16 (Primary + Replica)
- **Image:** `postgres:16`
- **Local ports:** 5435 (primary), 5436 (replica) — remapped from 5432 to avoid Windows host conflict
- **Standard ports:** 5432 (primary), 5433 (replica) — use these in CI/Docker networking
- **Driver:** `postgres.js` v3 (NOT `pg`)
- **ORM:** Drizzle ORM v0.38
- **Schema:** Multi-tenant via separate schemas (`public` + `tenant_{id}` per tenant)
- **Migrations:** `packages/db-client/migrations/` — run with `drizzle-kit migrate`
  - `0000_worried_blue_marvel.sql` — 49 tables (Phases 0–2)
  - `0001_fresh_violations.sql` — 28 tables (Phases 3–4)
  - **Total: 77 tables**
- **Row Level Security (RLS):** Enabled via `TenantScopedDatabase` in `@erp/sdk`

### Redis 7
- **Image:** `redis:7-alpine`
- **Local port:** 6379
- **Client:** ioredis v5
- **Uses:**
  - Tenant status cache (tenant-service)
  - Feature flags cache (platform-sdk)
  - Distributed locks via Redlock (platform-sdk)
  - BullMQ job queue backend (scheduler-service)
  - Token blacklist (auth-service)
- **Config override:** `maxRetriesPerRequest: null` required by BullMQ
- **Note:** docker-compose runs a single Redis node (`redis-1`), NOT a cluster — `REDIS_CLUSTER_NODES` is present in env but single-node connection via `REDIS_URL` is the active path

### Elasticsearch 8.17
- **Image:** `elasticsearch:8.17.0`
- **Local port:** 9200
- **Security:** `xpack.security.enabled: false` (dev only)
- **Client:** Native `fetch` via REST API (no elasticsearch-js SDK installed)
- **Uses:**
  - Per-tenant indices: `erp_{tenantId}_{entity}` (e.g., `erp_1_items`)
  - Custom analyzer: `erp_name_analyzer` (synonyms + ngrams + shingles)
  - Fuzzy multi_match search across items, customers, suppliers

---

## 5. Cloud Services

### Current State: Local / Self-Hosted Only
No cloud provider is currently integrated in code. The infrastructure is 100% Docker-based for development.

### Planned / Referenced in CI
| Service | Reference | Status |
|---------|-----------|--------|
| **Docker Hub** | `nexoraatech/erp-{service}` images pushed via GitHub Actions | CI configured, not activated |
| **Kubernetes** | Deployment target mentioned in CI (`kubectl`, `helm` commands commented out) | Infrastructure stubs only |
| **Helm** | Referenced in CI deploy step for staging | Not yet written |

### Object Storage
| Service | Status | Notes |
|---------|--------|-------|
| **MinIO** | Active (local) | S3-compatible, runs in Docker on ports 9000/9001 |
| **AWS S3** | NOT configured | MinIO is the S3 replacement; no `@aws-sdk/client-s3` installed |

> MinIO is configured with env vars `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`.

### Secret Management
| Service | Status | Notes |
|---------|--------|-------|
| **HashiCorp Vault** | Active (local dev) | Runs in Docker on port 8200 in dev mode |

---

## 6. Third-Party Services

### SMS
| Service | Integration | Status |
|---------|------------|--------|
| **MSG91** | REST API (`https://api.msg91.com/api/v5/flow/`) | Implemented in `NotificationEngine.sendSms()` |

Config vars: `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`

### Email
| Service | Integration | Status |
|---------|------------|--------|
| **SendGrid** | REST API (`https://api.sendgrid.com/v3/mail/send`) | Implemented in `NotificationEngine.sendEmail()` |
| **Mailhog** | SMTP (dev only, port 1025) | Docker service for local email testing |

Config vars: `SENDGRID_API_KEY`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`

### WhatsApp
| Service | Integration | Status |
|---------|------------|--------|
| **Meta WhatsApp Cloud API** | REST API (`https://graph.facebook.com/v18.0/{phoneNumberId}/messages`) | Implemented in `NotificationEngine.sendWhatsApp()` |

Config vars: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`

### Payments
| Service | Status |
|---------|--------|
| **Razorpay** | NOT integrated — no package, no API calls found in codebase |
| **Stripe** | NOT integrated |

### Authentication
| Service | Status |
|---------|--------|
| **Auth0 / Clerk / Firebase Auth** | NOT used — custom RS256 JWT auth built from scratch |

### Monitoring / Observability
| Service | Status | Notes |
|---------|--------|-------|
| **Jaeger** | Active (local) | OTLP traces via port 4318, UI on port 16686 |
| **Prometheus** | Active (local) | Metrics scraping on port 9090 |
| **Grafana** | Active (local) | Dashboards on port 3001 |
| **Sentry** | NOT integrated |
| **Datadog / New Relic** | NOT integrated |

### CI/CD Services
| Service | Status |
|---------|--------|
| **Codecov** | Integrated via `codecov/codecov-action@v5` in GitHub Actions |
| **Trivy (Aqua Security)** | Integrated for Docker image vulnerability scanning |

---

## 7. APIs

### Internal APIs (REST)
All services expose REST APIs under `/api/v2/` prefix. No GraphQL, no gRPC, no WebSockets for primary data.

| Service | Base Path | Port | Key Endpoints |
|---------|-----------|------|--------------|
| auth-service | `/auth/` | 3010 | login, refresh, logout, users, roles |
| tenant-service | `/api/v2/` | 3011 | tenants, organization, branches, approvals |
| inventory-service | `/api/v2/` | 3012 | warehouses, categories, brands, units, items, stock-adjustments, stock-transfers, physical-verifications |
| sales-service | `/api/v2/` | 3013 | customers, suppliers, invoices, payments, quotations, sale-returns, delivery-challans |
| notification-service | `/api/v2/` | 3014 | notifications, preferences, SSE stream |
| report-service | `/api/v2/` | 3015 | reports/generate (PDF) |
| scheduler-service | `/api/v2/` | 3016 | jobs, import/export |
| search-service | `/api/v2/` | 3017 | search |
| gst-service | `/api/v2/` | 3018 | gst/compute, gst/rates, hsn |
| accounting-service | `/api/v2/` | 3019 | accounts, opening-balances |
| api-gateway | TBD | TBD | Reverse proxy to all services |

### SSE (Server-Sent Events)
- `notification-service` implements SSE for in-app real-time push (`/api/v2/notifications/stream`)

### External APIs Called
| API | URL | Used By |
|-----|-----|---------|
| MSG91 | `https://api.msg91.com/api/v5/flow/` | notification-service |
| SendGrid | `https://api.sendgrid.com/v3/mail/send` | notification-service |
| Meta Graph API | `https://graph.facebook.com/v18.0/` | notification-service |

---

## 8. Authentication

### Implementation: Custom RS256 JWT

**Algorithm:** RS256 (asymmetric — RSA 2048-bit key pair)

**Library:** `jose` v5 (`importSPKI`, `jwtVerify`, `SignJWT`, `importPKCS8`)

**Flow:**
1. User submits `email + password + tenantId` to `POST /auth/login`
2. auth-service hashes password with **Argon2id** (`argon2` package)
3. On match, signs RS256 JWT with private key:
   - `sub`: userId
   - `tenantId`, `email`, `roles[]`, `permissions[]`
4. Returns `accessToken` (default 15 min / `JWT_ACCESS_TOKEN_TTL`) + `refreshToken` (7 days / `JWT_REFRESH_TOKEN_TTL`)
5. All non-auth services verify JWTs using `JWT_PUBLIC_KEY` in `authenticate.ts` middleware

**Key storage in `.env`:**
```
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n<base64>\n-----END PRIVATE KEY-----\n
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n<base64>\n-----END PUBLIC KEY-----\n
```
Keys stored as single-line with literal `\n` — all `authenticate.ts` files apply `.replace(/\\n/g, '\n')` before `importSPKI()`.

**RBAC:** 185 permission constants in `packages/shared-types/src/permissions.ts`, 9 default roles (OWNER → STAFF). Enforced via `requirePermission()` middleware in each service.

**Rate Limiting:** Login endpoint limited via `@fastify/rate-limit`. Default: 10 requests per 5 min (configurable via `LOGIN_RATE_LIMIT_MAX` and `LOGIN_RATE_LIMIT_WINDOW_MS`).

**Account Lockout:** Implemented in auth-service after repeated failed attempts.

**Refresh Token Rotation:** Single-use refresh tokens; invalidated on use and replaced.

---

## 9. DevOps

### Containerisation
| Tool | Version | Usage |
|------|---------|-------|
| **Docker** | Latest | All infrastructure runs in Docker |
| **Docker Compose** | v3+ | Local dev orchestration — 13 service definitions |
| **Docker Buildx** | v3 | Multi-arch builds in CI |

### CI/CD — GitHub Actions
**File:** `.github/workflows/ci.yml`

| Job | Trigger | What it does |
|-----|---------|-------------|
| `lint` | push/PR | ESLint + Prettier check |
| `type-check` | push/PR | `tsc --noEmit` |
| `test` | push/PR | Vitest with PostgreSQL 16 + Redis 7 service containers |
| `build` | after all pass | Build Docker images for 13 services (matrix) |
| `security-scan` | after build (non-PR) | Trivy SARIF scan → GitHub Security |
| `deploy-staging` | on git tag `v*` | Kubernetes deploy (commented stubs) |

**Branches triggering CI:** `main`, `develop`, `ERP-*`

**Docker Hub org:** `nexoraatech/erp-{service-name}`

### Security Scanning
| Tool | Integration |
|------|------------|
| **Trivy** (Aqua Security) | `aquasecurity/trivy-action@master` — scans CRITICAL/HIGH CVEs in Docker images |
| **GitHub CodeQL** | SARIF upload via `github/codeql-action/upload-sarif@v3` |

### Deployment Target (Planned)
| Tool | Status |
|------|--------|
| **Kubernetes** | Defined in CI deploy step (kubectl commands commented) |
| **Helm** | Referenced for staging deploy (`./infrastructure/helm/erp`) — charts not yet written |

### Process Management
| Tool | Status |
|------|--------|
| **PM2** | NOT used |
| **Supervisor** | NOT used |
| **Nginx** | NOT configured (api-gateway handles proxying) |

---

## 10. Testing

| Tool | Version | Used By |
|------|---------|---------|
| **Vitest** | ^2.1.8 | All backend services + `@erp/sdk` package |
| **@vitest/coverage-v8** | ^2.1.8 | Coverage reports (V8 provider) |

**Coverage gate:** ≥ 80% enforced in GitHub Actions CI (`test:coverage` job).

**Pattern:** `describe.skipIf(!process.env['DATABASE_URL'])` — integration tests skip when DB is unavailable (CI-safe).

**Integration test files (real PostgreSQL):**
- `apps/inventory-service/src/__tests__/item.integration.test.ts`
- `apps/sales-service/src/__tests__/customer.integration.test.ts`
- `apps/accounting-service/src/__tests__/accounts.integration.test.ts`
- `apps/tenant-service/src/__tests__/tenant.integration.test.ts`

**NOT used:**
- No Jest
- No Cypress / Playwright
- No Testing Library (frontend untested currently)
- No supertest (Vitest handles HTTP tests)

---

## 11. Mobile Technologies

**Not applicable.** This project has no mobile app.
- No React Native
- No Flutter
- No Capacitor / Ionic
- No Swift / Kotlin

The `apps/pos-frontend` is a web SPA (React + Vite), not a native mobile app — it runs in-browser on POS terminal hardware.

---

## 12. Build Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **Turborepo** | ^2.3.3 | Monorepo task orchestration (build, test, lint pipelines) |
| **Vite** | ^6.0.5 | Frontend build + dev server (web-frontend, pos-frontend) |
| **TypeScript Compiler (`tsc`)** | ^5.7.3 | Backend service builds (`tsc` → `dist/`) |
| **tsx** | ^4.19.2 | TypeScript executor for dev watching |

**Build output:** Backend services compile to `dist/` via `tsc`. Shared packages compile to `dist/index.js` + `dist/index.d.ts`. All packages use ESM (`"type": "module"`).

**Turbo task DAG:**
```
build → dependsOn: ["^build"]  (packages must build before apps)
dev   → dependsOn: ["^build"]  (packages built first, then services start)
test  → dependsOn: ["^build"]
lint  → dependsOn: ["^lint"]
```

**Dev concurrency:** `pnpm turbo run dev --concurrency=20` (15 services need > default 10)

**NOT used:**
- No Webpack
- No Rollup (separate)
- No Babel / SWC
- No esbuild (directly — Vite uses it internally)
- No Nx

---

## 13. Package Managers

| Tool | Version | Usage |
|------|---------|-------|
| **pnpm** | 9.15.0 (pinned) | Workspace package manager |

**Workspace config:** `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**pnpm overrides (root `package.json`):**
```json
{ "ioredis": "^5.11.0" }
```

**Node version:** ≥ 20.0.0 (`.nvmrc` file present for nvm users)

**NOT used:**
- No npm workspaces
- No Yarn
- No pip / poetry / cargo / composer

---

## 14. Infrastructure

### Full Docker Compose Stack (13 containers)

| Container | Image | Port(s) | Role |
|-----------|-------|---------|------|
| `erp-postgres-primary` | `postgres:16` | 5435→5432 | Primary PostgreSQL write DB |
| `erp-postgres-replica` | `postgres:16` | 5436→5432 | Replica PostgreSQL read DB |
| `erp-redis-1` | `redis:7-alpine` | 6379 | Cache + BullMQ + locks |
| `erp-zookeeper` | `confluentinc/cp-zookeeper:7.6.0` | 2181 | Kafka coordinator |
| `erp-kafka` | `confluentinc/cp-kafka:7.6.0` | 29092 | Message broker |
| `erp-minio` | `minio/minio:RELEASE.2024-12-18T13-15-44Z` | 9000, 9001 | Object storage (S3-compatible) |
| `erp-elasticsearch` | `elasticsearch:8.17.0` | 9200, 9300 | Full-text search |
| `erp-jaeger` | `jaegertracing/all-in-one:latest` | 16686, 4317, 4318 | Distributed tracing |
| `erp-prometheus` | `prom/prometheus:v3.1.0` | 9090 | Metrics collection |
| `erp-grafana` | `grafana/grafana:11.4.0` | 3001→3000 | Metrics dashboards |
| `erp-mailhog` | `mailhog/mailhog:v1.0.1` | 1025 (SMTP), 8025 (UI) | Dev email testing |
| `erp-vault` | `hashicorp/vault:1.18` | 8200 | Secrets management |

**Network:** All containers share `erp-network` (bridge driver).

### Message Queue
- **Kafka 3.6** (Confluent Platform 7.6) — outbox event relay, domain event consumers
- **BullMQ** (backed by Redis) — scheduled jobs (33 system cron jobs in scheduler-service)

### Object Storage
- **MinIO** — S3-compatible, stores file uploads, import files, generated PDFs

### Caching
- **Redis** — tenant status cache (15 min TTL), feature flags, distributed locks

### Reverse Proxy / API Gateway
- **`@erp/api-gateway`** — Fastify-based, uses `@fastify/http-proxy` to forward to microservices — **not yet fully implemented**
- No Nginx configured
- **ES-27 decision (2026-07-04): explicitly descoped, not built.** `api-gateway` remains a 4-line
  stub (`export {}`). It has been removed from the CI build/security-scan matrices, the
  `network-policy.yaml` NetworkPolicy podSelector reference, and the Prometheus scrape config —
  previously these referenced it as if it were live, which was the H2 audit finding. Until it's
  built, every backend service is reached directly and independently enforces its own auth (see
  ES-21 RBAC hardening). Follow-up phase: "ES-28 — API Gateway Implementation."

---

## 15. Security

### Authentication
- RS256 JWT (asymmetric — 2048-bit RSA, `jose` library)
- Argon2id password hashing (`argon2` package)
- Refresh token rotation (single-use)
- Account lockout after failed attempts

### Encryption
| Method | Library | Used For |
|--------|---------|---------|
| **AES-256-GCM** | `node:crypto` (built-in) | Field-level encryption of sensitive data (GSTIN, PAN, bank accounts) |
| **RS256** | `jose` | JWT signing/verification |
| **Argon2id** | `argon2` | Password hashing |

AES-256-GCM implementation: `packages/shared-utils/src/encryption.ts`
- `encryptField(plaintext, keyHex)` → `"ivB64:tagB64:ctB64"` format
- `decryptField(encoded, keyHex)` → plaintext
- Key: 32-byte hex string from `FIELD_ENCRYPTION_KEY` env var
- **CRITICAL:** This key is immutable once data is encrypted. No rotation mechanism exists yet.

### Secret Management
- **HashiCorp Vault** (dev mode) — configured but not yet wired to services programmatically
- Secrets passed via environment variables via root `.env` (loaded via `tsx --env-file ../../.env`)

### HTTP Security
| Library | Applied To |
|---------|-----------|
| **@fastify/helmet** | All backend services — sets security headers |
| **@fastify/cors** | All backend services — restricts allowed origins |
| **@fastify/rate-limit** | auth-service (login), api-gateway |

### Input Validation
- **Zod v3** — all request bodies and query params validated before handlers execute
- Zod errors returned as 500 with JSON array (some services) or 400 (best practice — standardise in Phase 5+)

### CSRF
- Not implemented — REST API + Bearer token auth (stateless — no cookie sessions)

### RBAC
- 185 permission constants
- `requirePermission(PERMISSIONS.XXX)` Fastify preHandler
- `PermissionRoute` in React frontend guards all 21+ pages

---

## 16. AI Stack

**Not applicable.** No AI/ML technologies are integrated.
- No OpenAI / Anthropic / Gemini SDK
- No LangChain / LlamaIndex
- No vector database
- No embeddings
- No RAG pipeline
- No AI-assisted features in the product

---

## 17. Major Libraries — Complete Reference Table

| Library | Version | Purpose | Package(s) |
|---------|---------|---------|-----------|
| `fastify` | ^4.28.0 | HTTP framework | All backend services |
| `@fastify/cors` | ^9.0.1 | CORS middleware | All backend services |
| `@fastify/helmet` | ^11.1.1 | Security headers | All backend services |
| `@fastify/rate-limit` | ^9.1.0 | Rate limiting | auth-service, api-gateway |
| `@fastify/http-proxy` | ^9.4.0 | HTTP proxying | api-gateway |
| `drizzle-orm` | ^0.38.3 | Type-safe ORM | All data services |
| `drizzle-kit` | ^0.30.1 | Migration generator | db-client (devDep) |
| `postgres` | ^3.4.5 | PostgreSQL driver | db-client |
| `zod` | ^3.24.0 | Schema validation | All services + frontends |
| `jose` | ^5.9.6–5.10.0 | JWT (RS256) | auth, tenant, inventory, sales, gst, accounting |
| `argon2` | ^0.41.1 | Password hashing | auth-service, tenant-service |
| `ioredis` | ^5.4.1 | Redis client | cache-client, auth, tenant, scheduler, platform-sdk |
| `kafkajs` | ^2.2.4 | Kafka client | event-bus-client, platform-sdk |
| `bullmq` | ^5.34.6 | Job queue | scheduler-service |
| `redlock` | ^5.0.0-beta.2 | Distributed locks | platform-sdk |
| `ulid` | ^2.3.0 | ULID ID generation | auth, sales, notification, scheduler, platform-sdk |
| `handlebars` | ^4.7.8 | HTML templates | notification-service, report-service |
| `puppeteer` | ^23.11.1 | Headless Chrome / PDF | report-service |
| `winston` | ^3.17.0 | Structured logging | logger package |
| `winston-transport` | ^4.9.0 | Log transport base | logger package |
| `prom-client` | ^15.1.3 | Prometheus metrics | logger package |
| `@opentelemetry/api` | ^1.9.0 | OTel tracing API | platform-sdk |
| `@opentelemetry/sdk-node` | ^0.57.0 | OTel Node SDK | platform-sdk |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.57.0 | OTLP trace export | platform-sdk |
| `@opentelemetry/resources` | ^1.28.0 | OTel resource descriptors | platform-sdk |
| `@opentelemetry/semantic-conventions` | ^1.28.0 | OTel attribute names | platform-sdk |
| `tsx` | ^4.19.2 | TS dev executor | All backend services (devDep) |
| `vitest` | ^2.1.8 | Test runner | All backend services + platform-sdk (devDep) |
| `@vitest/coverage-v8` | ^2.1.8 | Coverage via V8 | platform-sdk (devDep) |
| `react` | ^19.0.0 | UI framework | web-frontend, pos-frontend |
| `react-dom` | ^19.0.0 | DOM renderer | web-frontend, pos-frontend |
| `react-router-dom` | ^7.0.2 | Client-side routing | web-frontend, pos-frontend |
| `@tanstack/react-query` | ^5.62.16 | Server state management | web-frontend, pos-frontend |
| `zustand` | ^5.0.2 | Global state | web-frontend, pos-frontend |
| `react-hook-form` | ^7.54.2 | Form management | web-frontend, pos-frontend |
| `@hookform/resolvers` | ^3.9.1 | Zod form integration | web-frontend, pos-frontend |
| `lucide-react` | ^0.468.0 | Icons | web-frontend, pos-frontend |
| `recharts` | ^2.15.0 | Charts | web-frontend only |
| `react-hot-toast` | ^2.4.1 | Toast notifications | web-frontend, pos-frontend |
| `tailwindcss` | ^4.0.0 | CSS framework | web-frontend, pos-frontend (devDep) |
| `@tailwindcss/vite` | ^4.0.0 | Tailwind Vite plugin | web-frontend, pos-frontend (devDep) |
| `vite` | ^6.0.5 | Frontend build tool | web-frontend, pos-frontend (devDep) |
| `@vitejs/plugin-react` | ^4.3.4 | React Vite plugin | web-frontend, pos-frontend (devDep) |
| `turbo` | ^2.3.3 | Monorepo orchestration | root (devDep) |
| `typescript` | ^5.7.3 | TypeScript compiler | All packages (devDep) |
| `eslint` | ^9.17.0 | Linter | root (devDep) |
| `@typescript-eslint/parser` | ^8.20.0 | TS ESLint parser | root (devDep) |
| `@typescript-eslint/eslint-plugin` | ^8.20.0 | TS ESLint rules | root (devDep) |
| `prettier` | ^3.4.2 | Code formatter | root (devDep) |
| `husky` | ^9.1.7 | Git hooks | root (devDep) |
| `lint-staged` | ^15.3.0 | Pre-commit linting | root (devDep) |
| `@commitlint/cli` | ^19.6.1 | Commit message linting | root (devDep) |
| `@commitlint/config-conventional` | ^19.6.0 | Conventional commits rules | root (devDep) |

---

## 18. Architecture

### Pattern: Event-Driven Microservices Monorepo

```
Architecture Type: Microservices
Communication: REST (sync) + Kafka Outbox (async)
Domain Model: DDD (Domain-Driven Design)
State Changes: Saga pattern (multi-step transactional flows)
Read Model: CQRS projections (projection_dashboard_daily, projection_customer_balance, projection_stock_level)
Persistence: PostgreSQL (write model) + Elasticsearch (search read model)
Multi-tenancy: Schema-per-tenant (tenant_1, tenant_2, ...) + Row-Level Security
```

### Microservices (15 apps)

| Service | Status | Responsibility |
|---------|--------|---------------|
| auth-service | COMPLETE | Authentication, JWT, RBAC, user management |
| tenant-service | COMPLETE | Tenant lifecycle, provisioning saga (9 steps), org/branch CRUD |
| inventory-service | COMPLETE | Stock management, warehouses, items, adjustments, transfers, physical verification |
| sales-service | COMPLETE | Invoices, payments, quotations, returns, delivery challans, customers |
| notification-service | COMPLETE | Multi-channel (SMS/Email/WhatsApp/In-App) notification engine |
| report-service | COMPLETE | PDF generation (6 document types via Puppeteer + Handlebars) |
| scheduler-service | COMPLETE | 33 cron jobs via BullMQ, import/export engine |
| search-service | COMPLETE | Elasticsearch-backed full-text search |
| gst-service | COMPLETE | GST computation (CGST+SGST vs IGST), HSN master |
| accounting-service | COMPLETE | Chart of Accounts, opening balances wizard |
| api-gateway | STUB | Route aggregation (not yet fully implemented) |
| purchase-service | STUB | Not started (Phase 5) |
| hr-service | STUB | Not started (future phase) |
| web-frontend | COMPLETE | React SPA for ERP admin |
| pos-frontend | COMPLETE | React SPA for Point of Sale |

### Shared Packages (8 packages)

| Package | Name | Responsibility |
|---------|------|---------------|
| `packages/shared-types` | `@erp/types` | Shared TypeScript types, permission constants, error classes |
| `packages/config` | `@erp/config` | `requireEnv()` helper for environment variable validation |
| `packages/db-client` | `@erp/db` | Drizzle ORM setup, all schema files, migrations |
| `packages/cache-client` | `@erp/cache` | `TenantScopedCache` (ioredis wrapper) |
| `packages/event-bus-client` | `@erp/events` | KafkaJS producer/consumer wrappers |
| `packages/logger` | `@erp/logger` | Winston structured logger + Prometheus metrics |
| `packages/shared-utils` | `@erp/utils` | AES-256-GCM `encryptField`/`decryptField` |
| `packages/platform-sdk` | `@erp/sdk` | `PlatformContextFactory`, audit, events (outbox/inbox), feature flags, workflow engine, rule engine |

### Event Pattern: Transactional Outbox
All state-changing operations write to `outbox_events` table in the **same DB transaction** as the business data.
A relay worker (not yet running) polls and publishes to Kafka. Consumers use `inbox_events` for idempotency.

```
Service Write → (outbox_events INSERT in same TX) → Relay Worker → Kafka → Consumer → inbox_events idempotency check → downstream update
```

---

## 19. Project Structure

```
d:\NEXORAA\sales-erp-app\
│
├── apps/                          # 15 deployable applications
│   ├── auth-service/              # Port 3010 — JWT auth + RBAC
│   ├── tenant-service/            # Port 3011 — multi-tenancy
│   ├── inventory-service/         # Port 3012 — stock management
│   ├── sales-service/             # Port 3013 — invoicing + payments
│   ├── notification-service/      # Port 3014 — MSG91/SendGrid/WhatsApp
│   ├── report-service/            # Port 3015 — Puppeteer PDF
│   ├── scheduler-service/         # Port 3016 — BullMQ cron jobs
│   ├── search-service/            # Port 3017 — Elasticsearch
│   ├── gst-service/               # Port 3018 — GST computation
│   ├── accounting-service/        # Port 3019 — CoA + journals
│   ├── api-gateway/               # Port TBD — Fastify reverse proxy (stub)
│   ├── hr-service/                # NOT STARTED — HR/payroll (stub)
│   ├── purchase-service/          # NOT STARTED — procurement (stub)
│   ├── web-frontend/              # Vite React SPA — ERP admin UI
│   └── pos-frontend/              # Vite React SPA — POS terminal UI
│
├── packages/                      # 8 shared workspace packages
│   ├── shared-types/              # @erp/types — TypeScript types + permissions
│   ├── config/                    # @erp/config — env var helpers
│   ├── db-client/                 # @erp/db — Drizzle ORM + all schemas + migrations
│   │   ├── src/schema/            # Schema files: index.ts, master.ts, items.ts, sales.ts, inventory.ts, gst.ts, accounting.ts
│   │   └── migrations/            # SQL migration files (0000, 0001, ...)
│   ├── cache-client/              # @erp/cache — Redis cache abstraction
│   ├── event-bus-client/          # @erp/events — KafkaJS wrapper
│   ├── logger/                    # @erp/logger — Winston + prom-client
│   ├── shared-utils/              # @erp/utils — AES-256-GCM encryption
│   └── platform-sdk/              # @erp/sdk — PlatformContext, audit, events, feature flags, workflow, rule engine
│
├── infrastructure/                # Docker + Prometheus + Grafana configs
│   └── docker/
│       ├── postgres/init.sql      # DB init script
│       ├── prometheus/            # prometheus.yml config
│       └── grafana/               # Grafana provisioning
│
├── ERP-PLANNING/                  # Planning artifacts (not shipped)
│   ├── phase-prompts/             # Claude session prompts per phase
│   ├── phase-completions/         # Completed phase reports (handoff docs)
│   ├── CODING_STANDARDS.md        # Coding standards reference
│   ├── PHASE_COMPLETION_TEMPLATE.md
│   └── PHASE_FIX_AUDIT_P0_P2.md
│
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── docker-compose.yml             # Local dev infrastructure (13 containers)
├── .env.example                   # Environment variable template
├── .env                           # Local secrets (gitignored)
├── package.json                   # Root — devDeps (turbo, eslint, prettier, commitlint, husky)
├── pnpm-workspace.yaml            # pnpm monorepo config
├── turbo.json                     # Turborepo task pipeline
├── tsconfig.base.json             # Shared TypeScript base config
├── eslint.config.mjs              # ESLint v9 flat config
├── .prettierrc                    # Prettier config
├── .lintstagedrc.json             # lint-staged config
├── commitlint.config.cjs          # Commitlint conventional commit config
├── .nvmrc                         # Node.js version pin
└── TECH_AUDIT.md                  # This file
```

---

## 20. Environment Variables

### Required Variables

| Variable | Purpose | Service | Required |
|----------|---------|---------|---------|
| `NODE_ENV` | Runtime environment (`development`/`production`/`test`) | All | Yes |
| `LOG_LEVEL` | Log verbosity (`debug`/`info`/`warn`/`error`) | All | No (default: `info`) |
| `DATABASE_URL` | PostgreSQL primary connection string | All data services | Yes |
| `DATABASE_REPLICA_URL` | PostgreSQL replica connection string | Read-heavy services | No |
| `REDIS_URL` | Redis connection URL | auth, tenant, scheduler, platform-sdk | Yes |
| `REDIS_CLUSTER_NODES` | Redis cluster node list | platform-sdk | No (single-node fallback) |
| `KAFKA_BROKERS` | Comma-separated Kafka broker addresses | event-bus-client, platform-sdk | Yes |
| `KAFKA_CLIENT_ID` | Kafka client identifier | event-bus-client | No (default: `erp`) |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint (`host:port`) | scheduler-service | Yes |
| `MINIO_ACCESS_KEY` | MinIO access key | scheduler-service | Yes |
| `MINIO_SECRET_KEY` | MinIO secret key | scheduler-service | Yes |
| `MINIO_USE_SSL` | Use HTTPS for MinIO | scheduler-service | No (default: `false`) |
| `MINIO_BUCKET` | MinIO bucket name | scheduler-service | Yes |
| `ELASTICSEARCH_URL` | Elasticsearch REST endpoint | search-service | Yes |
| `VAULT_ADDR` | HashiCorp Vault address | future services | No |
| `VAULT_TOKEN` | HashiCorp Vault token | future services | No |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint | All via platform-sdk | No |
| `OTEL_SERVICE_NAME` | Service name for tracing | All via platform-sdk | No |
| `OTEL_TRACES_EXPORTER` | Trace exporter type (`otlp`) | All via platform-sdk | No |
| `JWT_PRIVATE_KEY` | RS256 private key (single-line `\n`-escaped PEM) | auth-service | Yes |
| `JWT_PUBLIC_KEY` | RS256 public key (single-line `\n`-escaped PEM) | All backend services | Yes |
| `JWT_ACCESS_TOKEN_TTL` | Access token lifetime (seconds, default: 900 = 15 min) | auth-service | No |
| `JWT_REFRESH_TOKEN_TTL` | Refresh token lifetime (seconds, default: 604800 = 7 days) | auth-service | No |
| `LOGIN_RATE_LIMIT_MAX` | Max login attempts per window (default: 10) | auth-service | No |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | Rate limit window in ms (default: 300000 = 5 min) | auth-service | No |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM key as 32-byte hex string | inventory, sales | Yes |
| `INTERNAL_API_KEY` | Service-to-service auth key | scheduler-service | Yes |
| `SMTP_HOST` | SMTP server hostname | notification-service | Yes |
| `SMTP_PORT` | SMTP server port | notification-service | Yes |
| `SMTP_FROM` | From email address | notification-service | Yes |
| `MSG91_AUTH_KEY` | MSG91 API authentication key | notification-service | Yes (prod) |
| `MSG91_TEMPLATE_ID` | MSG91 SMS template ID | notification-service | Yes (prod) |
| `SENDGRID_API_KEY` | SendGrid v3 API key (`SG.xxx`) | notification-service | Yes (prod) |
| `SMTP_FROM_ADDRESS` | SendGrid from email | notification-service | No |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp phone number ID | notification-service | Yes (prod) |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp access token | notification-service | Yes (prod) |
| `NOTIFICATION_SERVICE_URL` | Internal URL for notification-service | tenant-service | No |
| `INVENTORY_SERVICE_URL` | Internal URL for inventory-service | scheduler-service | No |
| `SALES_SERVICE_URL` | Internal URL for sales-service | scheduler-service | No |
| `GST_SERVICE_URL` | Internal URL for gst-service | scheduler-service | No |
| `ACCOUNTING_SERVICE_URL` | Internal URL for accounting-service | scheduler-service | No |
| `PORT` | HTTP port override (defaults per service, 3010–3019) | Each service | No |
| `REPORT_SERVICE_PORT` | Port override for report-service (default: 3015) | report-service | No |
| `NOTIFICATION_SERVICE_PORT` | Port override for notification-service (default: 3014) | notification-service | No |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | All backend services | No |

> **JWT Key format CRITICAL:** Keys must be stored as single-line with literal `\n`:
> `JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n`
> All `authenticate.ts` middleware files apply `.replace(/\\n/g, '\n')` before use.

---

## 21. License Audit

### Key Licenses

| License | Packages | Risk |
|---------|---------|------|
| **MIT** | fastify, drizzle-orm, zod, react, vite, tailwindcss, zustand, recharts, winston, ioredis, jose, handlebars, bullmq, kafkajs, ulid, turbo, vitest, tsx, prettier, eslint, lucide-react, puppeteer, redlock, prom-client, react-router-dom, react-hook-form, @tanstack/react-query | ✅ No restrictions |
| **Apache 2.0** | @opentelemetry/* | ✅ No restrictions |
| **ISC** | argon2 | ✅ No restrictions |
| **BSD-3-Clause** | react-hot-toast | ✅ No restrictions |
| **LGPL** | None detected | N/A |
| **GPL / AGPL** | None detected | ✅ No copyleft risk |

### Notable Notes
- **Puppeteer** includes Chromium which has its own license (BSD-style). Chromium is downloaded separately by Puppeteer at install time.
- **confluentinc/cp-kafka** and **confluentinc/cp-zookeeper** Docker images are under Confluent Community License — free for development, **requires license check for production SaaS use at scale**.
- **HashiCorp Vault** (`hashicorp/vault`) uses BSL 1.1 since August 2023. Dev/test use is free; production use may require a Vault Enterprise license or HCP Vault. Verify before production deployment.
- All custom code is proprietary (private: true in all `package.json` files).

---

## 22. Unused / Stub Dependencies

### Fully Stubbed Services (no real implementation)
| Service | Status | Notes |
|---------|--------|-------|
| `apps/api-gateway` | Partial stub | `@fastify/http-proxy` installed; routing not wired |
| `apps/purchase-service` | Empty stub | All deps installed, no domain logic |
| `apps/hr-service` | Empty stub | All deps installed, no domain logic |

### Missing Dependencies Found During Runtime
| Package | Missing From | Added? | Notes |
|---------|------------|--------|-------|
| `ulid` | `apps/sales-service` | ✅ Added in validation session | Required for `InvoiceService`, `SaleReturnService`, `PaymentService` outbox inserts |
| `jose` | Not in all service `package.json` | Partial | Works via pnpm hoisting but should be explicit |

### Potentially Redundant
| Situation | Details |
|-----------|---------|
| ~~`@erp/events` (event-bus-client) vs `@erp/sdk` (platform-sdk)~~ | **RESOLVED (ES-25, M11):** confirmed dead — `createEventProducer`/`createEventConsumer` unconditionally threw, zero real importers (only a dead vitest-config alias in `apps/auth-service`). Package deleted; the SDK's `PlatformEventBus`/`PlatformEventConsumer` is the only event-bus path. See `ES-25_COMPLETION.md` |
| `@erp/cache` (cache-client) vs `ioredis` in SDK | Cache-client wraps ioredis; SDK also uses ioredis directly. Consistent usage: always go through `@erp/sdk` `TenantScopedCache` |

### Deprecated / Watch List
| Package | Concern |
|---------|---------|
| `puppeteer` ^23.11.1 | Deprecated puppeteer@23.11.1 warning during install. Latest stable works; monitor for upgrade |
| `redlock` ^5.0.0-beta.2 | Still in beta (v5). Stable v4 exists. Should upgrade when v5 is stable |

---

## 23. Dependency Graph

```
┌─────────────────────── FRONTEND ───────────────────────────────┐
│  web-frontend (React 19 + Vite 6 + Tailwind v4)               │
│    └── React Router v7 + TanStack Query v5 + Zustand v5        │
│    └── react-hook-form + zod + lucide-react + recharts         │
│    └── @erp/types + @erp/utils                                  │
│                                                                 │
│  pos-frontend (React 19 + Vite 6 + Tailwind v4)               │
│    └── React Router v7 + TanStack Query v5 + Zustand v5        │
│    └── react-hook-form + zod + lucide-react                    │
│    └── @erp/types + @erp/utils                                  │
└─────────────────────────────────────────────────────────────────┘
                             │ REST /api/v2/
                             ▼
┌─────────────────── BACKEND SERVICES ───────────────────────────┐
│  All services: Fastify v4 + Zod + @erp/sdk                     │
│                                                                 │
│  auth-service ──── jose (RS256 JWT) + argon2 + ioredis         │
│  tenant-service ── jose + argon2 + ioredis                     │
│  inventory-service jose + drizzle-orm + @erp/utils (AES)       │
│  sales-service ─── jose + drizzle-orm + ulid + @erp/utils      │
│  gst-service ───── jose + drizzle-orm                          │
│  accounting-service jose + drizzle-orm + @erp/utils            │
│  notification-service ─ handlebars                             │
│     └── MSG91 REST API (SMS)                                   │
│     └── SendGrid REST API (Email)                              │
│     └── Meta Graph API v18.0 (WhatsApp)                        │
│  report-service ── puppeteer (Chromium) + handlebars           │
│  scheduler-service bullmq + ioredis                            │
│  search-service ── fetch (Elasticsearch REST)                  │
│  api-gateway ───── @fastify/http-proxy                         │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────── SHARED PACKAGES ───────────────────────────────┐
│  @erp/sdk (platform-sdk)                                       │
│    ├── PlatformContextFactory (per-request context)            │
│    ├── TenantScopedDatabase (Drizzle + RLS)                    │
│    ├── TenantScopedCache (ioredis)                             │
│    ├── DistributedLockManager (redlock)                        │
│    ├── PlatformAuditLogger                                      │
│    ├── PlatformEventBus / OutboxPublisher (kafkajs outbox)     │
│    ├── PlatformEventConsumer (inbox idempotency)               │
│    ├── PlatformFeatureFlags (Redis-cached)                     │
│    ├── WorkflowEngine (20 system definitions)                  │
│    ├── RuleEngine (11 operators, 6 action types)               │
│    └── OpenTelemetry (OTLP → Jaeger)                          │
│                                                                 │
│  @erp/db (db-client) ─── drizzle-orm + postgres.js            │
│  @erp/logger ──────────── winston + prom-client               │
│  @erp/cache ───────────── ioredis                             │
│  @erp/events ──────────── kafkajs                             │
│  @erp/utils ───────────── node:crypto (AES-256-GCM)           │
│  @erp/types ───────────── TypeScript types only               │
│  @erp/config ──────────── requireEnv() helper                 │
└────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────── INFRASTRUCTURE ────────────────────────────┐
│                                                                │
│  PostgreSQL 16 ─── port 5435 (primary), 5436 (replica)        │
│    └── 77 tables, multi-tenant schemas, Drizzle migrations     │
│                                                                │
│  Redis 7 ────────── port 6379                                 │
│    └── Cache + BullMQ + Redlock                               │
│                                                                │
│  Kafka 3.6 ─────── port 29092 (external), 9092 (internal)    │
│    └── Domain events (outbox relay → consumers)               │
│    └── Zookeeper on port 2181                                 │
│                                                                │
│  MinIO ─────────── port 9000 (API), 9001 (console)            │
│    └── S3-compatible object storage                           │
│                                                                │
│  Elasticsearch 8.17 ── port 9200                              │
│    └── Per-tenant indices: erp_{tenantId}_{entity}            │
│                                                                │
│  Jaeger ─────────── port 4318 (OTLP), 16686 (UI)             │
│  Prometheus ──────── port 9090                                │
│  Grafana ─────────── port 3001                               │
│  Mailhog ─────────── port 1025 (SMTP), 8025 (UI)             │
│  HashiCorp Vault ─── port 8200                               │
└────────────────────────────────────────────────────────────────┘
```

---

## 23b. Kubernetes & Service Mesh (Production Infrastructure)

Production deployment infrastructure exists under `infrastructure/` — these manifests are **not used locally** but define the production target.

### Kubernetes Manifests (`infrastructure/k8s/`)

| File | What it defines |
|------|----------------|
| `namespace.yaml` | Namespace `erp-system` |
| `auth-service.yaml` | Deployment (2 replicas), Service, HPA — with Vault agent sidecar injection |
| `<service>.yaml` (13 more, added ES-27) | Same pattern as `auth-service.yaml` for sales, inventory, accounting, purchase, hr, gst, notification, scheduler, search, report, tenant, event, production-service — all 14 backend services now have a manifest. `api-gateway` intentionally excluded (descoped, see §Reverse Proxy / API Gateway). |
| `network-policy.yaml` | Firewall rules restricting inter-service traffic |
| `cert-manager.yaml` | ACME TLS certificate provisioning |
| `vault-config.yaml` | Vault secret paths and role bindings for each service |

**Vault Sidecar Pattern (production):** Each Kubernetes pod has a Vault agent sidecar that injects secrets (`DATABASE_URL`, `JWT_PRIVATE_KEY`, etc.) as environment variables from `erp/data/{service}/` paths in Vault KV store. No secrets in Kubernetes manifests.

### Istio Service Mesh (`infrastructure/istio/`)

| File | What it defines |
|------|----------------|
| `peer-authentication.yaml` | **mTLS STRICT mode** — all inter-service traffic must be mutual TLS |
| `authorization-policy.yaml` | RBAC at the network layer — which service can call which other service |

> Istio is a planned production dependency, not running locally. When Phase 5+ services are deployed, all inter-service calls will be encrypted via mTLS automatically.

**ES-27 confirmation (2026-07-04):** the two files above remain intentionally scaffolding-only —
policy definitions for a mesh that isn't installed. No Istio control plane, sidecar injection, or
`istioctl` bootstrap exists anywhere in this repo or its CI. Do not mistake these two YAML files
for a working service mesh in a future session; they're a target-state reference for when Istio is
actually installed in a real cluster.

### GitLab Mirror

**File:** `.github/workflows/gitlab-sync.yml`

- Mirrors `main` branch to `gitlab.com/nexoraa-tech-official/sales-erp-app` on every push
- Force push via `GITLAB_TOKEN` secret
- Reason: GitLab may be used as backup SCM or for GitLab CI in parallel
- **ES-27 resolution (2026-07-04):** `.gitlab-ci.yml` (repo root) has been deleted — it was dead
  code from the project's pre-migration Spring Boot layout (`sale-erp-backend`/`sale-erp-froentend`,
  EC2 SSH deploy script) and had never been updated for the current pnpm/TypeScript microservices
  monorepo; it would fail immediately if GitLab CI ever ran it. GitHub Actions (`.github/workflows/ci.yml`)
  is the sole authoritative CI/CD pipeline. This mirror workflow is unaffected — it only pushes
  commits to GitLab for backup, it doesn't invoke GitLab CI.

### Prometheus Scrape Config

Services expose `/metrics` endpoint (via `prom-client`). Prometheus scrapes:
- `auth-service:3010`
- `api-gateway:3000`
- `sales-service:3020` (production port, different from dev 3013)
- `inventory-service:3030` (production port, different from dev 3012)
- `accounting-service:3040` (production port, different from dev 3019)
- Kafka exporter: port `9308`

> **Note:** Production ports differ from local dev ports. Local uses 3010–3019; production Kubernetes uses different service port assignments.

### ESLint Rules (Critical for All Sessions)

These rules are enforced via `eslint.config.mjs` — violations will fail CI:

| Rule | Level | Implication |
|------|-------|------------|
| `no-console` | **error** | Never use `console.log` — use `createLogger()` from `@erp/logger` |
| `@typescript-eslint/no-explicit-any` | **error** | No `any` types — use `unknown` or proper types |
| `@typescript-eslint/no-unused-vars` | **error** | All vars used or prefixed with `_` |
| `@typescript-eslint/consistent-type-imports` | **error** | Use `import type` for type-only imports |
| `@typescript-eslint/explicit-function-return-type` | **warn** | Functions should declare return types |
| `@typescript-eslint/no-non-null-assertion` | **warn** | Avoid `!` non-null assertions |

**Prettier config** (enforced on all `.ts/.tsx/.js/.jsx/.json/.md/.yaml`):
- `singleQuote: true`, `semi: true`, `trailingComma: 'es5'`, `printWidth: 100`, `tabWidth: 2`, `endOfLine: 'lf'`

**Commitlint scopes** (25 defined — use one of these):
`sales | inventory | accounting | purchase | hr | gst | notification | scheduler | search | report | auth | tenant | api-gateway | platform-sdk | shared-types | shared-utils | db-client | cache-client | event-bus-client | logger | config | web-frontend | pos-frontend | infra | ci | deps | release`

---

## 24. Summary

### Complete Technology Stack

**Languages:** TypeScript 5.7 (primary), SQL, HTML/TSX, CSS/Tailwind, YAML, Bash

**Frontend:**
- React 19 + React Router v7 + Vite 6 + Tailwind CSS v4
- TanStack Query v5 + Zustand v5 + react-hook-form v7 + Zod v3
- Lucide React + Recharts + react-hot-toast

**Backend (all 13 services):**
- Node.js ≥20 + Fastify v4 + Zod v3 + TypeScript 5.7
- Drizzle ORM v0.38 + postgres.js v3 → PostgreSQL 16
- jose v5 (RS256 JWT) + argon2 (password hashing)
- ioredis v5 → Redis 7
- KafkaJS v2 → Kafka 3.6
- BullMQ v5 (scheduler-service only)
- Puppeteer v23 (report-service only)
- Handlebars v4 (notification + report service)
- Winston v3 + prom-client v15 (logging + metrics)
- OpenTelemetry → Jaeger (distributed tracing)
- ulid v2 (ID generation for outbox)

**Infrastructure:**
- Docker Compose (13 containers)
- PostgreSQL 16 (primary + replica)
- Redis 7
- Kafka 3.6 + Zookeeper
- MinIO (S3-compatible)
- Elasticsearch 8.17
- HashiCorp Vault 1.18
- Jaeger + Prometheus + Grafana
- Mailhog (dev email)

**DevOps:**
- GitHub Actions CI (lint / type-check / test / build / Trivy scan / deploy)
- Turborepo v2.3 (monorepo orchestration)
- pnpm v9.15 (package manager)
- Codecov (coverage reporting)
- Trivy (security scanning)
- Docker Hub (`nexoraatech/`) for image registry

**Third-Party Services:**
- MSG91 (SMS, India)
- SendGrid (transactional email)
- Meta WhatsApp Cloud API v18.0 (WhatsApp messaging)

**Architecture:** Event-driven microservices monorepo — 15 apps + 8 shared packages, Transactional Outbox pattern, CQRS projections, Saga orchestration, DDD

---

### Confidence Scores

| Technology | Confidence | Evidence |
|-----------|-----------|---------|
| TypeScript 5.7 | **High** | All `package.json` devDependencies |
| React 19 | **High** | `package.json` + `App.tsx` source |
| React Router v7 | **High** | `package.json` version `^7.0.2` |
| Vite 6 | **High** | `package.json` |
| Tailwind CSS v4 | **High** | `package.json` + `@tailwindcss/vite` plugin |
| Fastify v4 | **High** | All backend `package.json` files |
| Drizzle ORM v0.38 | **High** | All data service `package.json` files |
| postgres.js | **High** | `@erp/db` `package.json` |
| Zod v3 | **High** | All `package.json` + route source files |
| jose v5 | **High** | `package.json` + `authenticate.ts` source |
| argon2 | **High** | auth-service + tenant-service `package.json` |
| ioredis v5 | **High** | Multiple `package.json` + pnpm override |
| KafkaJS v2 | **High** | `@erp/events` + `@erp/sdk` `package.json` |
| BullMQ v5 | **High** | scheduler-service `package.json` |
| Puppeteer v23 | **High** | report-service `package.json` + `PdfEngine.ts` |
| Handlebars v4 | **High** | notification + report service `package.json` |
| Winston v3 | **High** | `@erp/logger` `package.json` + `index.ts` |
| prom-client v15 | **High** | `@erp/logger` `package.json` + `metrics.ts` |
| OpenTelemetry | **High** | `@erp/sdk` `package.json` |
| ulid v2 | **High** | Multiple `package.json` + source files |
| redlock v5 | **High** | `@erp/sdk` `package.json` |
| Turborepo v2 | **High** | root `package.json` + `turbo.json` |
| pnpm v9.15 | **High** | root `package.json` `packageManager` field |
| PostgreSQL 16 | **High** | `docker-compose.yml` image |
| Redis 7 | **High** | `docker-compose.yml` image |
| Kafka 3.6 (Confluent) | **High** | `docker-compose.yml` image |
| MinIO | **High** | `docker-compose.yml` image |
| Elasticsearch 8.17 | **High** | `docker-compose.yml` image |
| Jaeger | **High** | `docker-compose.yml` + env vars |
| Prometheus v3.1 | **High** | `docker-compose.yml` image |
| Grafana 11.4 | **High** | `docker-compose.yml` image |
| HashiCorp Vault 1.18 | **High** | `docker-compose.yml` image |
| Mailhog | **High** | `docker-compose.yml` + `SMTP_HOST` env var |
| MSG91 | **High** | `NotificationEngine.ts` + config.ts + env vars |
| SendGrid | **High** | `NotificationEngine.ts` + config.ts + env vars |
| Meta WhatsApp Cloud API | **High** | `NotificationEngine.ts` source + `graph.facebook.com` URL |
| GitHub Actions | **High** | `.github/workflows/ci.yml` |
| Trivy | **High** | GitHub Actions CI `trivy-action` |
| Codecov | **High** | GitHub Actions CI `codecov-action` |
| Kubernetes | **Medium** | CI deploy step references but kubectl commands commented out |
| Helm | **Medium** | Referenced in CI deploy step comment only |
| Vitest v2 | **High** | All backend service devDependencies |
| TanStack Query v5 | **High** | Frontend `package.json` |
| Zustand v5 | **High** | Frontend `package.json` + `auth.store.ts` source |
| react-hook-form v7 | **High** | Frontend `package.json` |
| Recharts v2 | **High** | `web-frontend/package.json` |
| lucide-react | **High** | Both frontend `package.json` |
| react-hot-toast | **High** | Both frontend `package.json` |
| RS256 / RSA-2048 JWT | **High** | `authenticate.ts` source + `.env` |
| AES-256-GCM encryption | **High** | `packages/shared-utils/src/encryption.ts` source |
| SSE (Server-Sent Events) | **High** | `NotificationEngine.ts` channel enum includes `IN_APP` + SSE endpoint pattern |
| Razorpay | **Not Found** | No package, no API calls in source |
| Stripe | **Not Found** | No package, no API calls |
| AWS SDK | **Not Found** | No `@aws-sdk/*` package |
| Firebase | **Not Found** | No package, no API calls |
| OpenAI / Anthropic | **Not Found** | No AI packages |
| Nginx | **Not Found** | No config files |
| PM2 | **Not Found** | Not in any `package.json` |
| Axios | **Not Found** | Not installed — native `fetch` used |
| GraphQL | **Not Found** | REST only |
| gRPC | **Not Found** | REST only |
