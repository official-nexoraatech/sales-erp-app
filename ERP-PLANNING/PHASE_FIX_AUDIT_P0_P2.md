# PHASE FIX AUDIT — P0 to P2 — SESSION STARTER PROMPT
## Paste this entire document as your first message in a new Claude session.

---

```
⚠️  THIS IS NOT A NEW PHASE.

This is a structured remediation session. An Architecture Review Board audit of the
ERP codebase (Phases 0, 1, and 2) was conducted on 2026-06-29 and found 25 gaps —
7 critical security/compliance violations, 10 architecture violations, and 8 production
hardening gaps. None of these gaps were part of the original phase plan. They were
discovered post-implementation.

Your job in this session is to fix ALL items listed below, in the order given. Do NOT
add new features. Do NOT begin Phase 3. Do NOT redesign anything that already works.
Patch exactly what is specified.

═══════════════════════════════════════════
MANDATORY READING (READ BEFORE WRITING ANY CODE)
═══════════════════════════════════════════

Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_0_COMPLETION.md
Read: ERP-PLANNING/phase-completions/PHASE_1_COMPLETION.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md

These five documents are your source of truth. Every fix must align with them.

═══════════════════════════════════════════
BACKGROUND — WHAT WAS BUILT (Phases 0–2)
═══════════════════════════════════════════

PHASE 0 — FOUNDATION (COMPLETE)
  - Turborepo monorepo, pnpm workspaces, TypeScript 5 strict
  - 8 shared packages: @erp/types, @erp/config, @erp/logger, @erp/utils,
    @erp/db, @erp/cache, @erp/events, @erp/sdk
  - Docker Compose: 13 services (pg, redis×3, kafka, minio, elasticsearch,
    jaeger, prometheus, grafana, mailhog, vault)
  - Platform SDK: PlatformContextFactory, TenantScopedDatabase (RLS),
    TenantScopedCache, DistributedLockManager, PlatformAuditLogger,
    PlatformEventBus (outbox), PlatformFeatureFlags, OpenTelemetry
  - Auth Service (port 3010): Argon2id, RS256 JWT, refresh rotation, RBAC middleware

PHASE 1 — PLATFORM ENGINES (COMPLETE)
  - apps/tenant-service (port 3011): 9-step provisioning saga, lifecycle
    (suspend/activate/close)
  - apps/notification-service: SMS/Email/WhatsApp/In-App, SSE, quiet hours
  - apps/report-service: Puppeteer, Handlebars, 6 document types,
    NumberSeriesEngine
  - apps/scheduler-service: BullMQ, 33 system jobs, distributed lock,
    ImportEngine (validate only — execute is a stub)
  - apps/search-service: Elasticsearch, per-tenant indices, fuzzy search
  - packages/platform-sdk: WorkflowEngine (20 definitions), RuleEngine
    (11 operators, 6 action types)

PHASE 2 — MASTER DATA (COMPLETE — BUT WITH AUDIT GAPS)
  Services rebuilt:
    - apps/inventory-service (port 3012): warehouses, categories, brands,
      units, items (variants, barcode, price history), price lists — 28 endpoints
    - apps/sales-service (port 3013): customers (360° view, merge, history),
      suppliers — 16 endpoints
    - apps/gst-service (port 3018): GSTCalculator, HSN seed (45 textile rows),
      validate/search/compute — 5 endpoints
    - apps/accounting-service (port 3019): CoA (63 accounts, 2-pass seed, tree),
      Opening Balances Wizard (5-step + lock) — 16 endpoints
  Tenant-service additions:
    - Organization settings, Branch CRUD — 8 endpoints
  Auth-service additions:
    - User management CRUD, lock/unlock, branch assignment — 11 endpoints
  DB schemas:
    - packages/db-client/src/schema/master.ts (warehouses, customers, suppliers)
    - packages/db-client/src/schema/items.ts (categories, brands, units, items,
      variants, priceLists)
    - packages/db-client/src/schema/gst.ts (gstRates, hsnMaster)
    - packages/db-client/src/schema/accounting.ts (accounts, openingBalances)
  Frontend:
    - apps/web-frontend: React 19 + Vite 6 + Tailwind v4 + TanStack Query v5
    - 21 pages: Login, Dashboard, Organization, Branches, Warehouses, Users,
      Customers, Suppliers, Items, Categories, Brands, Units, Price Lists,
      GST Config, Chart of Accounts, Opening Balances Wizard

═══════════════════════════════════════════
AUDIT FINDINGS SUMMARY
═══════════════════════════════════════════

The following gaps were found. Fix them in EXACTLY the order listed below (FA.1 first,
FA.15 last). P0 items are security-critical — do not skip or defer them.

PRIORITY LEGEND:
  P0 = Security/compliance critical — cannot deploy without fixing
  P1 = Architecture violation — breaks patterns all future phases depend on
  P2 = Production hardening — required before go-live

═══════════════════════════════════════════
FIX MILESTONES
═══════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.1 — DB MIGRATIONS [P0 — Blocks ALL deployment]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: drizzle-kit generate has never been run. The Drizzle schemas exist only as
TypeScript — there are zero .sql migration files. Without migrations, the database
cannot be initialized in any real environment.

WHAT TO DO:
  1. Read packages/db-client/package.json to find the drizzle.config.ts location.
  2. Run: pnpm --filter @erp/db db:generate
     (or the equivalent drizzle-kit generate command configured in the package)
  3. Verify that a migrations/ folder is created with numbered .sql files covering ALL
     tables from Phases 0, 1, and 2:
       - Core: outbox_events, inbox_events, audit_log, feature_flags, saga_log
       - Auth: users, sessions, refresh_tokens, roles, role_permissions
       - Tenant: tenants, organization_settings, branches, user_branches, user_roles
       - Phase 1: workflow_definitions, workflow_instances, workflow_approvals,
         notification_templates, notification_log, notification_preferences,
         number_series_config, generated_documents, job_history, import_jobs,
         export_jobs, scheduled_job_configs, business_rules
       - Phase 2: warehouses, customers, customers_history, suppliers,
         suppliers_history, categories, brands, units, items, items_history,
         item_variants, price_lists, price_list_items, gst_rates, hsn_master,
         accounts, opening_balance_wizard, opening_balance_entries
  4. Commit the generated migration files to git.
  5. If drizzle.config.ts doesn't exist, create it:
       import { defineConfig } from 'drizzle-kit';
       export default defineConfig({
         schema: './src/schema/index.ts',
         out: './migrations',
         dialect: 'postgresql',
         dbCredentials: { url: process.env.DATABASE_URL! },
       });
     Place it in packages/db-client/.

VERIFY: migrations/ folder contains at least 1 .sql file, and the file includes
CREATE TABLE statements for all tables listed above.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.2 — AUTHENTICATION + PERMISSION GUARDS ON PHASE 2 SERVICES [P0 — Security]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: All Phase 2 service routes (inventory-service, sales-service, gst-service,
accounting-service) have zero authentication middleware. Any HTTP caller — unauthenticated
— can read, create, update, or delete master data.

The authenticate and requirePermission middleware already exist in:
  apps/auth-service/src/middleware/authenticate.ts
  apps/auth-service/src/middleware/authorize.ts

THESE CANNOT BE IMPORTED DIRECTLY across services — they use auth-service-specific JWT
verification. Each Phase 2 service needs its own equivalent middleware that:
  1. Reads the Bearer token from Authorization header
  2. Calls the auth-service /api/v2/auth/verify endpoint (or verifies the RS256 JWT
     locally using the public key — preferred for performance)
  3. Attaches { tenantId, userId, permissions[] } to request.auth

WHAT TO DO for each Phase 2 service:

  A. Create apps/{service}/src/middleware/authenticate.ts in EACH of:
       - apps/inventory-service/src/middleware/authenticate.ts
       - apps/sales-service/src/middleware/authenticate.ts
       - apps/gst-service/src/middleware/authenticate.ts
       - apps/accounting-service/src/middleware/authenticate.ts

     Pattern (copy from auth-service but use @erp/config to get the public key path):
       import { createPublicKey } from 'node:crypto';
       import jwt from 'jsonwebtoken';
       import { requireEnv } from '@erp/config';

       export async function authenticate(request, reply) {
         const header = request.headers.authorization;
         if (!header?.startsWith('Bearer ')) {
           return reply.code(401).send({ error: 'Missing Authorization header' });
         }
         try {
           const token = header.slice(7);
           const publicKey = requireEnv('JWT_PUBLIC_KEY_PATH');
           // verify RS256 — same key as auth-service
           const payload = jwt.verify(token, { key: publicKey, format: 'pem' },
                                      { algorithms: ['RS256'] });
           request.auth = payload;
         } catch {
           return reply.code(401).send({ error: 'Invalid or expired token' });
         }
       }

  B. Create apps/{service}/src/middleware/authorize.ts in each service:
       import { PERMISSIONS } from '@erp/types';
       export function requirePermission(permission) {
         return async (request, reply) => {
           if (!request.auth?.permissions?.includes(permission)) {
             return reply.code(403).send({
               error: `Forbidden — missing permission: ${permission}`
             });
           }
         };
       }

  C. Add preHandlers to EVERY route in these files:
       apps/inventory-service/src/api/warehouse.routes.ts
       apps/inventory-service/src/api/category.routes.ts
       apps/inventory-service/src/api/brand.routes.ts
       apps/inventory-service/src/api/unit.routes.ts
       apps/inventory-service/src/api/item.routes.ts
       apps/sales-service/src/api/customer.routes.ts
       apps/sales-service/src/api/supplier.routes.ts
       apps/gst-service/src/api/gst.routes.ts
       apps/accounting-service/src/api/accounts.routes.ts
       apps/accounting-service/src/api/opening-balances.routes.ts
       apps/tenant-service/src/api/organization.routes.ts
       apps/tenant-service/src/api/branch.routes.ts
       apps/tenant-service/src/api/approval.routes.ts

  D. Permission mapping — use these from @erp/types PERMISSIONS:
       GET /warehouses         → PERMISSIONS.WAREHOUSE_VIEW
       POST/PUT /warehouses    → PERMISSIONS.WAREHOUSE_MANAGE
       GET /customers          → PERMISSIONS.CUSTOMER_VIEW
       POST/PUT /customers     → PERMISSIONS.CUSTOMER_CREATE / CUSTOMER_EDIT
       DELETE /customers       → PERMISSIONS.CUSTOMER_DELETE
       GET /items              → PERMISSIONS.ITEM_VIEW
       POST/PUT /items         → PERMISSIONS.ITEM_CREATE / ITEM_EDIT
       GET /accounts           → PERMISSIONS.ACCOUNT_VIEW
       POST/PUT /accounts      → PERMISSIONS.ACCOUNT_CREATE
       POST /opening-balances/lock → PERMISSIONS.OPENING_BALANCE_LOCK
       GET /suppliers          → PERMISSIONS.SUPPLIER_VIEW
       POST/PUT /suppliers     → PERMISSIONS.SUPPLIER_CREATE / SUPPLIER_EDIT
       POST /gst/compute       → PERMISSIONS.GST_COMPUTE (or INVOICE_CREATE)
       GET /organization       → no permission required (all authenticated users)
       PUT /organization       → PERMISSIONS.ORG_SETTINGS_EDIT
       GET /branches           → PERMISSIONS.BRANCH_VIEW
       POST/PUT /branches      → PERMISSIONS.BRANCH_MANAGE

     If a specific PERMISSION constant doesn't exist in @erp/types, check
     packages/types/src/permissions.ts and add it there following the existing pattern.

VERIFY: curl -X GET http://localhost:3012/warehouses (no token) → 401 Unauthorized.
VERIFY: curl with valid token but wrong permissions → 403 Forbidden.
VERIFY: curl with valid token and correct permissions → 200 OK.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.3 — AES-256-GCM FIELD ENCRYPTION [P0 — PII / Compliance]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: GSTIN, PAN (customer/supplier), and supplier bank account numbers are stored
as plaintext in the database. The ERP_MASTER_SPEC.md §9 requires AES-256-GCM encryption
for all PII fields. Currently only a SHA-256 hash is stored in the companion _hash
column (e.g., gstin_hash, pan_hash, bank_account_hash). The plaintext is unencrypted.

HOW TO IMPLEMENT:
  The Platform SDK already has the infrastructure stub. Add a real encrypt() / decrypt()
  utility to @erp/utils or @erp/sdk:

  File: packages/utils/src/encryption.ts
    import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

    const ALGORITHM = 'aes-256-gcm';
    const IV_LENGTH = 12;
    const TAG_LENGTH = 16;

    export function encryptField(plaintext: string, keyHex: string): string {
      const key = Buffer.from(keyHex, 'hex');  // 32 bytes
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Format: iv(12)+tag(16)+ciphertext — base64 encoded
      return Buffer.concat([iv, tag, encrypted]).toString('base64');
    }

    export function decryptField(encoded: string, keyHex: string): string {
      const key = Buffer.from(keyHex, 'hex');
      const buf = Buffer.from(encoded, 'base64');
      const iv = buf.subarray(0, IV_LENGTH);
      const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext) + decipher.final('utf8');
    }

  The encryption key must come from the environment:
    FIELD_ENCRYPTION_KEY=<64-char hex string>   (= 32 bytes = 256-bit key)
  Add this to docker-compose.yml env for each affected service.

WHERE TO APPLY ENCRYPTION:

  1. apps/sales-service/src/api/customer.routes.ts — POST and PUT /customers:
     Before inserting/updating, if gstin is provided:
       const encryptedGstin = encryptField(body.gstin, requireEnv('FIELD_ENCRYPTION_KEY'));
       const gstinHash = sha256(body.gstin);  // keep existing hash for lookup
     Store encryptedGstin in the gstin column (or add a gstin_encrypted column).
     Same for pan → pan_encrypted.

  2. apps/sales-service/src/api/supplier.routes.ts — POST and PUT /suppliers:
     Same for gstin, pan.
     For bank_account_no:
       const encryptedBankAccount = encryptField(body.bankAccountNo, FIELD_ENCRYPTION_KEY);
     Store encrypted value in bank_account_no column.
     Expose decrypted value only on GET /suppliers/:id (with SUPPLIER_BANK_VIEW permission).

  3. On READ (GET /:id):
     Decrypt before returning to the client:
       gstin: decryptField(row.gstin, FIELD_ENCRYPTION_KEY)
     But for LIST endpoints (GET /customers), return gstin as masked (first 5 + last 4
     characters, middle replaced with ***).

SCHEMA CHANGE:
  If current column type VARCHAR is not wide enough for the encrypted blob, change
  affected column types to TEXT in the Drizzle schema. Re-run drizzle-kit generate
  after this change (FA.1 must already be done).

VERIFY:
  - POST /customers with GSTIN → stored value in DB is NOT the plaintext GSTIN
  - GET /customers/:id → returns decrypted GSTIN
  - GET /customers (list) → returns masked GSTIN (e.g., "27AAA**1234Z")
  - DB column contains base64 encrypted blob, not raw GSTIN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.4 — API /api/v2/ PREFIX [P1 — Architecture Violation]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: CODING_STANDARDS §6.1 requires all routes to be prefixed with /api/v2/.
Currently, every service uses bare paths (/customers, /items, /accounts, etc.).
This affects all services.

WHAT TO DO:
  In each service's main.ts, register routes under a prefix. Fastify supports this
  natively via fastify.register(plugin, { prefix: '/api/v2' }).

  TENANT-SERVICE (apps/tenant-service/src/main.ts):
    Change: await tenantRoutes(fastify, db, config)
    To:     await fastify.register(async (sub) => tenantRoutes(sub, db, config),
                                   { prefix: '/api/v2' })
    Same for: organizationRoutes, branchRoutes, approvalRoutes

  INVENTORY-SERVICE (apps/inventory-service/src/main.ts):
    await fastify.register(async (sub) => {
      await warehouseRoutes(sub, db);
      await categoryRoutes(sub, db);
      await brandRoutes(sub, db);
      await unitRoutes(sub, db);
      await itemRoutes(sub, db);
    }, { prefix: '/api/v2' });

  SALES-SERVICE (apps/sales-service/src/main.ts):
    await fastify.register(async (sub) => {
      await customerRoutes(sub, db);
      await supplierRoutes(sub, db);
    }, { prefix: '/api/v2' });

  GST-SERVICE (apps/gst-service/src/main.ts):
    await fastify.register(async (sub) => gstRoutes(sub, db), { prefix: '/api/v2' });

  ACCOUNTING-SERVICE (apps/accounting-service/src/main.ts):
    await fastify.register(async (sub) => {
      await accountRoutes(sub, db);
      await openingBalancesRoutes(sub, db);
    }, { prefix: '/api/v2' });

  AUTH-SERVICE (apps/auth-service/src/main.ts):
    Same — wrap all route registrations under { prefix: '/api/v2' }.

  KEEP /health and /metrics WITHOUT the prefix (they are infrastructure endpoints).

FRONTEND UPDATE:
  After adding the prefix to backends, update the BASE_URLS in:
    apps/web-frontend/src/api/client.ts
  All API paths in apps/web-frontend/src/api/endpoints.ts must also be updated to
  include /api/v2/ prefix in all fetch paths.

VERIFY: curl http://localhost:3012/api/v2/warehouses → 200 (with auth token)
VERIFY: curl http://localhost:3012/warehouses → 404

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.5 — PLATFORMCONTEXT IN PHASE 2 ROUTES [P1 — Architecture Violation]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: All Phase 2 service routes have signature (fastify, db: ErpDatabase). They
access the database directly — bypassing PlatformContext which provides audit logging,
outbox events, distributed cache, and distributed tracing. Every future phase (3–11)
uses PlatformContext. Phase 2 must be retrofitted.

PATTERN TO FOLLOW (from packages/platform-sdk/src/context.ts):
  PlatformContextFactory.create(tenant: TenantContext) → PlatformContext

WHAT TO DO:

  1. In each Phase 2 service main.ts, create a PlatformContextFactory:
       import { PlatformContextFactory } from '@erp/sdk';
       const ctxFactory = new PlatformContextFactory({
         databaseUrl: requireEnv('DATABASE_URL'),
         redisUrl: requireEnv('REDIS_URL'),
         kafkaBrokers: requireEnv('KAFKA_BROKERS').split(','),
         kafkaClientId: 'inventory-service',
         serviceName: 'inventory-service',
       });
       await ctxFactory.connect();
     Pass ctxFactory to the route registration function instead of db.

  2. Change route function signatures from:
       export async function itemRoutes(fastify, db: ErpDatabase)
     To:
       export async function itemRoutes(fastify, ctxFactory: PlatformContextFactory)

  3. Inside each route handler, build the context from request.auth:
       const ctx = ctxFactory.create({
         tenantId: request.auth.tenantId,
         userId: request.auth.userId,
         correlationId: request.headers['x-correlation-id'] as string
                        ?? crypto.randomUUID(),
       });

  4. Replace ALL direct db.select()... calls with ctx.db.select()...
     The ctx.db is a TenantScopedDatabase that automatically scopes to tenant.

  NOTE: TenantScopedDatabase has the same Drizzle API as ErpDatabase.
  Read packages/platform-sdk/src/database.ts to confirm the exact interface.

FILES TO CHANGE:
  - apps/inventory-service/src/main.ts + all 5 route files
  - apps/sales-service/src/main.ts + 2 route files
  - apps/gst-service/src/main.ts + 1 route file
  - apps/accounting-service/src/main.ts + 2 route files

VERIFY: After the change, route handlers use ctx.db, ctx.audit, ctx.events instead of
the raw db parameter.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.6 — OUTBOX EVENTBUS.PUBLISH() WIRING [P1 — Event-Driven Architecture]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: After FA.5 is complete, ctx.events is available but never called. Phase 2
routes contain TODO stub comments where event publishing should happen. Downstream
consumers (notification-service, search-service) will never trigger without this.

IMPORTANT: FA.5 MUST be complete before FA.6. The ctx object is required.

Event publishing uses the outbox pattern — ctx.events.publish() writes to the
outbox_events table IN THE SAME DB TRANSACTION as the business data insert/update.
Never call ctx.events.publish() outside a transaction.

Read packages/platform-sdk/src/events.ts for the exact publish() signature:
  ctx.events.publish(eventType: string, aggregateType: string, aggregateId: number,
                     payload: Record<string, unknown>)

EVENTS TO WIRE (minimum required):

  CUSTOMER EVENTS (apps/sales-service/src/api/customer.routes.ts):
    POST /customers (create):
      await ctx.events.publish('CUSTOMER_CREATED', 'customer', customer.id, {
        displayName: customer.displayName, phone: customer.phone,
        customerType: customer.customerType, branchId: customer.branchId,
      });
    PUT /customers/:id (update):
      await ctx.events.publish('CUSTOMER_UPDATED', 'customer', id, { changes: body });
    DELETE /customers/:id (soft delete):
      await ctx.events.publish('CUSTOMER_DELETED', 'customer', id, { deletedBy: userId });

  SUPPLIER EVENTS (apps/sales-service/src/api/supplier.routes.ts):
    POST /suppliers:  SUPPLIER_CREATED
    PUT /suppliers/:id: SUPPLIER_UPDATED

  ITEM EVENTS (apps/inventory-service/src/api/item.routes.ts):
    POST /items:  ITEM_CREATED (include hsnCode, gstRate for search indexing)
    PUT /items/:id: ITEM_UPDATED
    DELETE /items/:id: ITEM_DELETED

  ACCOUNT EVENTS (apps/accounting-service/src/api/accounts.routes.ts):
    POST /accounts: ACCOUNT_CREATED
    POST /accounts/seed: CHART_OF_ACCOUNTS_SEEDED

  OPENING BALANCE EVENTS (apps/accounting-service/src/api/opening-balances.routes.ts):
    POST /opening-balances/lock: OPENING_BALANCES_LOCKED

  WAREHOUSE EVENTS (apps/inventory-service/src/api/warehouse.routes.ts):
    POST /warehouses: WAREHOUSE_CREATED
    PUT /warehouses/:id: WAREHOUSE_UPDATED

TRANSACTION PATTERN:
  Events must be published inside the same DB transaction as the entity insert:
    await ctx.db.transaction(async (trx) => {
      const [entity] = await trx.insert(customers).values({...}).returning();
      await ctx.events.publishInTransaction(trx, 'CUSTOMER_CREATED', 'customer',
                                            entity.id, { ... });
    });
  If ctx.events.publishInTransaction() doesn't exist, check if publish() accepts a
  transaction parameter, or if it auto-uses the current transaction context.
  Read the implementation in packages/platform-sdk/src/events.ts first.

VERIFY: After POST /customers, query SELECT * FROM outbox_events WHERE aggregate_type =
'customer' — should see a row with published = false.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.7 — AUDIT LOGGING [P1 — Compliance]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: The audit_log table is always empty. PlatformAuditLogger exists in the SDK
but ctx.audit.log() is never called in any route handler. This is required for
compliance (every write must be traceable to a user).

IMPORTANT: FA.5 (PlatformContext) must be complete before FA.7.

Read packages/platform-sdk/src/audit.ts for the exact log() signature.
Expected signature:
  ctx.audit.log(action: string, entityType: string, entityId: number,
                beforeData?: unknown, afterData?: unknown)

ADD TO THESE ROUTE HANDLERS:

  All POST (create) routes: log after successful insert
    await ctx.audit.log('CREATE', 'customer', customer.id, null, customer);

  All PUT/PATCH (update) routes: log before+after
    // Fetch before:
    const [before] = await ctx.db.select().from(customers).where(eq(customers.id, id));
    // Do update
    const [after] = await ctx.db.update(customers).set({...}).where(...).returning();
    // Audit:
    await ctx.audit.log('UPDATE', 'customer', id, before, after);

  All DELETE (soft delete) routes: log the deletion
    await ctx.audit.log('DELETE', 'customer', id, before, { deletedAt: new Date() });

  Other important actions to log:
    - POST /accounts/seed → 'SEED_COA', 'chart_of_accounts', tenantId
    - POST /opening-balances/lock → 'LOCK', 'opening_balances', tenantId
    - POST /customers/:id/merge → 'MERGE', 'customer', targetId, source, target
    - POST /users/:id/lock → 'LOCK_USER', 'user', userId
    - POST /users/:id/unlock → 'UNLOCK_USER', 'user', userId
    - PATCH /admin/tenants/:id/suspend → 'SUSPEND', 'tenant', tenantId

  APPLY TO FILES:
    apps/sales-service/src/api/customer.routes.ts
    apps/sales-service/src/api/supplier.routes.ts
    apps/inventory-service/src/api/item.routes.ts
    apps/inventory-service/src/api/warehouse.routes.ts
    apps/inventory-service/src/api/category.routes.ts
    apps/inventory-service/src/api/brand.routes.ts
    apps/inventory-service/src/api/unit.routes.ts
    apps/accounting-service/src/api/accounts.routes.ts
    apps/accounting-service/src/api/opening-balances.routes.ts
    apps/auth-service/src/routes/users.ts
    apps/tenant-service/src/api/tenant.routes.ts (suspend/activate/close)

VERIFY: After PUT /customers/:id, query SELECT * FROM audit_log WHERE entity_type =
'customer' — should see a row with action='UPDATE', before_data, after_data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.8 — WORKFLOWENGINE SEEDING IN TENANTPROVISIONER [P1 — Platform Engine]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: TenantProvisioner.provision() does NOT call WorkflowEngine.seedDefinitions()
or RuleEngine.seedTemplates(). New tenants therefore have zero workflow definitions and
zero rule templates — making approval flows and business rules non-functional.

FILE: apps/tenant-service/src/domain/TenantProvisioner.ts

WHAT TO DO:
  1. Import WorkflowEngine and RuleEngine from @erp/sdk.
  2. After STEP 4 (SEED_ROLES_PERMISSIONS), add a new step:

     // ── STEP 4b: Seed workflow definitions ──────────────────────────────────
     const workflow = new WorkflowEngine(this.db, tenantId, 0, 'provisioning');
     await workflow.seedDefinitions(tenantId);

     // ── STEP 4c: Seed rule templates ────────────────────────────────────────
     const rules = new RuleEngine(this.db);
     await rules.seedTemplates(tenantId);

  3. Check the exact method names in:
       packages/platform-sdk/src/workflow.ts
       packages/platform-sdk/src/rule-engine.ts
     If the seeding methods have different names, use the correct names.

ALSO WIRE: SearchEngine.createTenantIndices() is already called via createEsIndices()
in TenantProvisioner — confirm this is correct and complete.

VERIFY: After provisioning a new tenant, query:
  SELECT COUNT(*) FROM workflow_definitions WHERE tenant_id = :newTenantId
  → should return 20 (the system workflow definitions count)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.9 — IMPORT EXECUTE() ENTITY HANDLERS [P1 — Import Engine]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: The ImportEngine in apps/scheduler-service/src/domain/ImportEngine.ts has
a validate() step that works correctly, but the execute() step is a stub that does
not actually insert any entities. Bulk import UI exists and users can upload CSVs,
but no data is saved.

FILE: apps/scheduler-service/src/domain/ImportEngine.ts

WHAT TO DO:
  Read the current execute() stub first. Then implement entity inserts for each of
  the 5 entity types the ImportEngine supports:

  1. CUSTOMERS — after validation, for each valid row:
       await db.insert(customers).values({
         tenantId: job.tenantId,
         displayName: row.displayName,
         phone: row.phone,
         customerType: row.customerType ?? 'RETAIL',
         branchId: row.branchId,
         creditLimit: row.creditLimit ?? 0,
         creditDays: row.creditDays ?? 0,
         createdBy: job.createdBy,
       }).onConflictDoNothing();

  2. SUPPLIERS — similar insert into suppliers table

  3. ITEMS — insert into items table; if item has variantAttributeIds, also insert
     item_variants; must set hsnCode, gstRate, unitId

  4. ACCOUNTS (Chart of Accounts) — insert into accounts with parentCode resolution
     (same 2-pass logic as the CoA seed: roots first, then children)

  5. OPENING_BALANCES — insert into opening_balance_entries

  BATCH SIZE: Process in batches of 100 rows. After each batch, update the import_job
  progress: { processed: n, total: total }.

  ON DUPLICATE: Use .onConflictDoNothing() for all inserts to make imports idempotent.

  ERROR HANDLING: If a row fails to insert (DB constraint violation), mark that row
  as failed in the job result but continue with remaining rows. Do NOT abort the entire
  import on a single row failure.

VERIFY: Upload a CSV of 10 customers → after execute() completes, query SELECT COUNT(*)
FROM customers → should increase by 10 (or fewer if duplicates).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.10 — OPTIMISTIC LOCKING ENFORCEMENT [P1 — Data Integrity]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: Every mutable entity table has a `version INTEGER NOT NULL DEFAULT 0` column.
But no UPDATE query checks WHERE version = :expectedVersion, and no UPDATE increments
the version. This means concurrent updates silently overwrite each other.

WHAT TO DO in every PUT/PATCH route that updates a mutable entity:

  PATTERN:
    1. Client sends { ...fields, version: N } in the request body (add to Zod schemas)
    2. The UPDATE query becomes:
         const result = await ctx.db
           .update(customers)
           .set({ ...updatedFields, version: sql`${customers.version} + 1` })
           .where(and(
             eq(customers.id, id),
             eq(customers.tenantId, tenantId),
             eq(customers.version, body.version)  // ← optimistic lock check
           ))
           .returning();

         if (result.length === 0) {
           throw new BusinessError(
             'OPTIMISTIC_LOCK_CONFLICT',
             'Record was modified by another user. Reload and try again.',
             { statusCode: 409 }
           );
         }

  APPLY TO:
    - PUT /customers/:id (customers table)
    - PUT /suppliers/:id (suppliers table)
    - PUT /items/:id (items table)
    - PUT /warehouses/:id (warehouses table)
    - PUT /accounts/:id (accounts table)
    - PUT /branches/:id (branches table)
    - PUT /organization (organization_settings table)
    - PUT /users/:id (users table)

  Also add `version: z.number().int().min(0)` to the Zod update schemas for each entity.

  On GET /:id, ensure the version field is included in the response so the frontend
  can send it back on update.

VERIFY: Fetch GET /customers/:id → get version: 5. Run two concurrent PUT /customers/:id
with version: 5 → exactly one succeeds (200), the other fails (409 OPTIMISTIC_LOCK_CONFLICT).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.11 — TEMPORAL HISTORY WRITES [P2 — Audit Trail]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: The customers_history, suppliers_history, and items_history tables exist in
the DB schema but no route handler ever inserts into them. These tables should capture
a snapshot of the entity state before each update for a full audit trail.

Read the history table schemas in packages/db-client/src/schema/master.ts and items.ts
to confirm the exact column names before writing code.

WHAT TO DO in each PUT route (after FA.10 is done so you have the before-state fetched):

  CUSTOMER HISTORY:
    In PUT /customers/:id, after fetching [before] and before executing the update:
      await ctx.db.insert(customersHistory).values({
        customerId: before.id,
        tenantId: before.tenantId,
        changedBy: userId,
        changedAt: new Date(),
        previousData: before,  // store full JSON snapshot
      });

  SUPPLIER HISTORY:
    Same pattern in PUT /suppliers/:id → insert into suppliersHistory.

  ITEM HISTORY:
    Same pattern in PUT /items/:id → insert into itemsHistory.

  IMPORTANT: The history insert must be in the SAME DB transaction as the update.
  Use ctx.db.transaction():
    await ctx.db.transaction(async (trx) => {
      await trx.insert(customersHistory).values({ ...historyRow });
      await trx.update(customers).set({ ...updateFields }).where(...);
    });

VERIFY: PUT /customers/:id twice → query SELECT * FROM customers_history WHERE
customer_id = :id → should have 2 rows (one per update).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.12 — SMTP EMAIL WIRING [P2 — Notification Engine]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: TenantProvisioner.sendWelcomeEmail() only calls logger.info() — no email is
actually sent. The NotificationEngine already supports email via SendGrid.

FILE: apps/tenant-service/src/domain/TenantProvisioner.ts

WHAT TO DO:
  Replace the stub with an HTTP call to the notification-service:
    private async sendWelcomeEmail(email: string, tenantName: string,
                                   firstName: string): Promise<void> {
      const notificationUrl = requireEnv('NOTIFICATION_SERVICE_URL');
      try {
        await fetch(`${notificationUrl}/api/v2/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
                     'x-internal-service-key': requireEnv('INTERNAL_SERVICE_KEY') },
          body: JSON.stringify({
            channel: 'email',
            recipient: email,
            templateKey: 'WELCOME_EMAIL',
            variables: { firstName, tenantName, loginUrl: requireEnv('APP_URL') },
          }),
        });
      } catch (err) {
        // Non-fatal — log and continue provisioning
        logger.warn({ email, err }, 'Welcome email failed to send (non-fatal)');
      }
    }

  Also ensure a WELCOME_EMAIL notification_template row is seeded in the
  notification_templates table. Check apps/notification-service/src/ for the seeding
  mechanism and add the template if it doesn't exist.

  Add required env vars to docker-compose.yml:
    NOTIFICATION_SERVICE_URL=http://notification-service:3014
    INTERNAL_SERVICE_KEY=<random 32-char secret>
    APP_URL=http://localhost:5173

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.13 — FIX suspendedBy / closedBy ATTRIBUTION [P2 — Audit Accuracy]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: In TenantProvisioner.suspend() and .close(), the acting user ID is passed
as hardcoded 0 from the route handler. The tenant lifecycle routes must require admin
authentication and pass the real user ID.

FILE: apps/tenant-service/src/api/tenant.routes.ts

WHAT TO DO:
  1. Add authenticate preHandler to the suspend/activate/close routes:
       fastify.patch<{Params: {id: string}}>(
         '/admin/tenants/:id/suspend',
         { preHandler: [authenticate] },
         async (request, reply) => { ... }
       )

  2. Extract the acting userId from request.auth:
       const actingUserId = request.auth.userId;

  3. Pass actingUserId to provisioner.suspend() / provisioner.close():
       await provisioner.suspend(id, body.data.reason, actingUserId);
       await provisioner.close(id, body.data.reason, actingUserId);

  Note: The admin tenant routes are a special case — they may be called by a platform
  super-admin user (tenantId=0). The authenticate middleware still applies;
  just extract the userId from the token.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.14 — FRONTEND PERMISSION GATE COMPONENT [P2 — Frontend Security]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: All 21 frontend pages show all UI elements (create/edit/delete buttons,
sensitive data) regardless of the logged-in user's role. The auth store stores the
JWT payload which includes permissions[]. A PermissionGate component is needed to
conditionally render UI based on the user's permissions.

FILES TO CREATE:

  1. apps/web-frontend/src/hooks/usePermission.ts
       import { useAuthStore } from '../store/auth.store';

       export function usePermission(permission: string): boolean {
         const permissions = useAuthStore((s) => s.user?.permissions ?? []);
         return permissions.includes(permission);
       }

       export function useAnyPermission(perms: string[]): boolean {
         const permissions = useAuthStore((s) => s.user?.permissions ?? []);
         return perms.some((p) => permissions.includes(p));
       }

  2. apps/web-frontend/src/components/PermissionGate.tsx
       import { usePermission } from '../hooks/usePermission';

       interface Props {
         permission: string;
         children: React.ReactNode;
         fallback?: React.ReactNode;
       }

       export function PermissionGate({ permission, children, fallback = null }: Props) {
         const allowed = usePermission(permission);
         return allowed ? <>{children}</> : <>{fallback}</>;
       }

  3. Create apps/web-frontend/src/constants/permissions.ts
     Mirror the backend PERMISSIONS constants as frontend strings:
       export const PERMISSIONS = {
         CUSTOMER_CREATE: 'CUSTOMER_CREATE',
         CUSTOMER_EDIT: 'CUSTOMER_EDIT',
         CUSTOMER_DELETE: 'CUSTOMER_DELETE',
         ITEM_CREATE: 'ITEM_CREATE',
         ITEM_EDIT: 'ITEM_EDIT',
         ACCOUNT_CREATE: 'ACCOUNT_CREATE',
         // ... add all relevant permissions
       } as const;

HOW TO USE IN PAGES (apply to all 21 pages):
  Wrap create/edit/delete buttons and sensitive data sections:

  Example in apps/web-frontend/src/pages/customers/CustomersPage.tsx:
    import { PermissionGate } from '../../components/PermissionGate';
    import { PERMISSIONS } from '../../constants/permissions';

    // Wrap the "New Customer" button:
    <PermissionGate permission={PERMISSIONS.CUSTOMER_CREATE}>
      <Button onClick={() => navigate('/customers/new')}>New Customer</Button>
    </PermissionGate>

    // Wrap edit/delete actions in DataTable:
    <PermissionGate permission={PERMISSIONS.CUSTOMER_EDIT}>
      <button onClick={() => navigate(`/customers/${id}/edit`)}>Edit</button>
    </PermissionGate>

  Apply the same pattern to:
    - SuppliersPage (SUPPLIER_CREATE/EDIT/DELETE)
    - ItemsPage / ItemFormPage (ITEM_CREATE/EDIT)
    - CategoriesPage / BrandsPage / UnitsPage (ITEM_CREATE)
    - UsersPage / UserFormPage (USER_MANAGE)
    - BranchesPage / WarehousesPage (BRANCH_MANAGE / WAREHOUSE_MANAGE)
    - ChartOfAccountsPage (ACCOUNT_CREATE + "Seed Default CoA" button)
    - OpeningBalancesPage — "Lock Opening Balances" button (OPENING_BALANCE_LOCK)
    - OrganizationPage "Save" button (ORG_SETTINGS_EDIT)

VERIFY: Log in as a VIEWER role user → "New Customer", "Edit", "Delete" buttons
are not rendered. Log in as ADMIN → all buttons visible.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FA.15 — INTEGRATION TESTS [P2 — CI/CD Quality Gate]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROBLEM: There are zero integration tests for any Phase 1 or Phase 2 service. Only
unit tests exist for platform-sdk. Without integration tests, CI cannot gate on
regressions in API behavior.

Write integration tests using Vitest + real PostgreSQL (use the Docker Compose test DB).
Do NOT use mocks for the database — the prior session's audit flagged that mock DBs
masked migration failures. Use real DB connections.

LOCATION: Create test files adjacent to each route file:
  apps/inventory-service/src/__tests__/item.integration.test.ts
  apps/sales-service/src/__tests__/customer.integration.test.ts
  apps/accounting-service/src/__tests__/accounts.integration.test.ts
  apps/tenant-service/src/__tests__/tenant.integration.test.ts

MINIMUM TEST COVERAGE REQUIRED:

  1. Tenant provisioning (apps/tenant-service):
     □ POST /api/v2/admin/tenants → 201, all 9 provisioning steps marked done
     □ POST duplicate slug → 409 DUPLICATE_TENANT
     □ PATCH /api/v2/admin/tenants/:id/suspend → 200, status = SUSPENDED
     □ PATCH /api/v2/admin/tenants/:id/activate → 200, status = ACTIVE
     □ GET /api/v2/admin/tenants/:id → workflow_definitions count >= 20 for new tenant

  2. Customer CRUD (apps/sales-service):
     □ POST /api/v2/customers (no auth) → 401
     □ POST /api/v2/customers (auth, wrong permission) → 403
     □ POST /api/v2/customers (auth, CUSTOMER_CREATE) → 201
     □ GSTIN stored encrypted (DB column != plaintext GSTIN)
     □ GET /api/v2/customers/:id → GSTIN decrypted in response
     □ PUT /api/v2/customers/:id with stale version → 409 OPTIMISTIC_LOCK_CONFLICT
     □ PUT /api/v2/customers/:id with correct version → 200, version incremented
     □ After PUT, audit_log has a row with action='UPDATE'
     □ After PUT, customers_history has a row

  3. Item creation (apps/inventory-service):
     □ POST /api/v2/items with invalid HSN → 422 validation error
     □ POST /api/v2/items with invalid GST rate → 422 validation error
     □ POST /api/v2/items valid → 201, outbox_events has ITEM_CREATED row
     □ GET /api/v2/items/by-barcode/:barcode → 200

  4. Chart of Accounts (apps/accounting-service):
     □ POST /api/v2/accounts/seed → 201, accounts count = 63
     □ GET /api/v2/accounts/tree → nested tree structure, no orphan nodes
     □ POST /api/v2/opening-balances/lock → 200 if trial balance balanced
     □ POST /api/v2/opening-balances/lock → 422 if trial balance != 0

TEST SETUP PATTERN:
  Use beforeAll to run migrations against a test DB, seed a test tenant, get auth token.
  Use afterAll to truncate tables.
  Import the Fastify app factory (not the bootstrap() function — export the app builder).

  Each service needs to export a buildApp(db) function for testing:
    export async function buildApp(db: ErpDatabase): Promise<FastifyInstance> { ... }
  The main.ts then calls buildApp(db) and fastify.listen().

VERIFY: pnpm test → all integration tests pass with a live PostgreSQL connection.

═══════════════════════════════════════════
COMPLETION CHECKLIST
═══════════════════════════════════════════

When all 15 fix milestones are done, verify:

  □ FA.1  Migration files exist in packages/db-client/migrations/ — committed to git
  □ FA.2  curl http://localhost:3012/api/v2/warehouses (no token) → 401
  □ FA.3  GSTIN in DB is base64 blob, not plaintext; GET /:id returns real GSTIN
  □ FA.4  All routes respond on /api/v2/... prefix; bare paths return 404
  □ FA.5  Route handlers use ctx.db, ctx.audit, ctx.events (no raw db parameter)
  □ FA.6  POST /customers → row in outbox_events with event_type='CUSTOMER_CREATED'
  □ FA.7  PUT /customers/:id → row in audit_log with action='UPDATE', before_data != null
  □ FA.8  New tenant provisioning → 20 rows in workflow_definitions for that tenant
  □ FA.9  Upload customers CSV → customers table count increases by row count
  □ FA.10 Concurrent PUT with same version → one 200, one 409
  □ FA.11 PUT /customers/:id → row in customers_history
  □ FA.12 Provisioning a tenant → check MailHog (http://localhost:8025) for welcome email
  □ FA.13 PATCH /admin/tenants/:id/suspend → suspendedBy in DB is actual admin userId, not 0
  □ FA.14 VIEWER role user → create/edit/delete buttons NOT rendered in React UI
  □ FA.15 pnpm test → integration tests pass

═══════════════════════════════════════════
WHAT NOT TO DO IN THIS SESSION
═══════════════════════════════════════════

✗ Do NOT start Phase 3 (Inventory Ledger, Stock Reservations, etc.)
✗ Do NOT redesign or refactor working code beyond what is specified
✗ Do NOT add new features beyond what is listed in the fix milestones
✗ Do NOT change the DB table names, column names, or entity schemas
  (only add missing columns like version check in Zod, or change VARCHAR to TEXT
  for encrypted fields — which requires new migration)
✗ Do NOT remove or replace the existing Zod validation schemas — extend them

═══════════════════════════════════════════
AFTER THIS SESSION
═══════════════════════════════════════════

When all 15 fix milestones are verified:
  1. Generate PHASE_FIX_AUDIT_COMPLETION.md using the template at
     ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md and save as
     ERP-PLANNING/phase-completions/PHASE_FIX_AUDIT_COMPLETION.md
  2. Then proceed to Phase 3 using:
     ERP-PLANNING/phase-prompts/PHASE_3_INVENTORY.md

═══════════════════════════════════════════
EFFORT ESTIMATE
═══════════════════════════════════════════

  FA.1  DB Migrations          — 1–2 hours
  FA.2  Auth + Permissions     — 4–6 hours
  FA.3  AES-256-GCM Encryption — 3–4 hours
  FA.4  /api/v2/ Prefix        — 2–3 hours
  FA.5  PlatformContext refactor— 5–8 hours
  FA.6  Outbox events          — 3–4 hours (depends on FA.5)
  FA.7  Audit logging          — 2–3 hours (depends on FA.5)
  FA.8  WorkflowEngine seeding — 1 hour
  FA.9  Import execute()       — 4–6 hours
  FA.10 Optimistic locking     — 2–3 hours
  FA.11 Temporal history       — 2–3 hours
  FA.12 SMTP wiring            — 1–2 hours
  FA.13 suspendedBy fix        — 0.5 hours
  FA.14 Frontend PermissionGate— 3–4 hours
  FA.15 Integration tests      — 8–12 hours

  TOTAL ESTIMATED: 41–61 hours (5–8 developer-days)
```
