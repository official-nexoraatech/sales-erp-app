# ES-20 — Audit Trail, Document Attachments & Feature Flags
## STATUS: 🔴 PENDING
## Sprint: 5 | Effort: 5–6 days | Risk: Low
## Depends on: ES-07 (VIEW_AUDIT_LOG), ES-17 (analytics), ES-18 (CRM), ES-19 (security)
## Unlocks: Production Release ✅

---

## YOUR ROLE

You are the **Principal Full-Stack Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement the final production-hardening features — comprehensive audit trail for all entity changes, document attachment system (invoices, POs, GRNs), PDF export for key documents, and a feature flag system for gradual rollout.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read all completion reports from ES-01 through ES-19 in `ERP-PLANNING/phase-completions/`
- [ ] Specifically confirm completed phases: ES-07 (VIEW_AUDIT_LOG), ES-17 (reports), ES-19 (security audit log)
- [ ] Read `apps/web-frontend/src/App.tsx` — list all current routes
- [ ] Read `packages/db-client/src/schema/` — list ALL tables (looking for `audit_log` if it exists)
- [ ] Check if S3/MinIO client exists in `packages/platform-sdk/src/`
- [ ] Check `.env.example` for S3/storage config
- [ ] Check `docker-compose.yml` for MinIO service
- [ ] Read `apps/report-service/src/domain/reports/` — list existing report files
- [ ] Run `pnpm build` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | JWT, rate limit, route fix |
| ES-02 ✅ | Outbox | Event relay running |
| ES-03 ✅ | Inventory | Ledger integrity |
| ES-04 ✅ | Migrations | All tables exist in DB |
| ES-05 ✅ | Reports | AR/AP Aging, tenant isolation |
| ES-06 ✅ | HR | Payroll encryption, holiday calendar |
| ES-07 ✅ | RBAC | VIEW_AUDIT_LOG permission ready |
| ES-08 ✅ | Sales | Full workflow complete |
| ES-09 ✅ | Purchase | Full workflow complete |
| ES-10 ✅ | GST | Cess, RCM, GSTR-9 |
| ES-11 ✅ | E-Invoice | IRN generation, EWB |
| ES-12 ✅ | Statutory HR | PF, ESI, Form 16 |
| ES-13 ✅ | Valuation | FIFO, WACC, COGS |
| ES-14 ✅ | Validation | Zod schemas, business rules |
| ES-15 ✅ | UX | Loading states, fixed assets |
| ES-16 ✅ | Performance | Indexes, Redis cache, health checks |
| ES-17 ✅ | Analytics | P&L, Balance Sheet, Sales, Inventory, HR reports |
| ES-18 ✅ | CRM | Customer 360, notifications, opt-out |
| ES-19 ✅ | Security | 2FA, impersonation, suspicious login |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | Redis 7 |
S3 / MinIO (file storage) | `@react-pdf/renderer` (PDF generation) |
React 18 + Vite 5 + Tailwind v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`
- File uploads: stored under `tenant/{tenantId}/` S3 prefix — NEVER allow cross-tenant access

### Feature Flag Rules
```typescript
// Simple DB-backed feature flags per tenant
// Flag check: if flag not found → default to false (safe default)
// Flags: enable/disable specific features for a tenant

// Feature flags needed:
// 'einvoice_enabled'     — whether e-invoice generation is active (ES-11)
// 'whatsapp_enabled'     — whether WhatsApp notifications are active (ES-18)
// 'fifo_valuation'       — whether FIFO costing is available (ES-13) (default: WACC)
// 'mfa_required'         — force all users to enroll 2FA (ES-19)
// 'purchase_3way_match'  — whether 3-way matching is enforced (ES-09)
```

### Audit Trail Rules
- Every CREATE, UPDATE, DELETE on business entities must write to `audit_log`
- `audit_log` is append-only (no UPDATE or DELETE)
- Contains: entity type, entity ID, action, changed fields (old/new values), actor, timestamp

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- S3 uploads: signed URLs for private downloads (not public URLs)
- PDF: render server-side for print-quality; client-side print via `window.print()` for simple ones
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Global audit trail (who changed what, when)
2. Document attachments (PDF invoices, upload GRN documents)
3. PDF export for invoices, payslips, P&L report
4. Feature flag system
5. Final production readiness verification

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Audit Trail**

`packages/db-client/src/schema/audit.ts` (new file or add to existing):
```sql
audit_log:
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id UUID NOT NULL
  entity_type VARCHAR(50) NOT NULL   -- 'INVOICE' | 'CUSTOMER' | 'ITEM' | etc.
  entity_id UUID NOT NULL
  action VARCHAR(20) NOT NULL        -- 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE'
  old_values JSONB
  new_values JSONB
  changed_fields TEXT[]              -- array of field names that changed
  actor_id UUID NOT NULL
  actor_email VARCHAR(255)
  ip_address INET
  created_at TIMESTAMPTZ DEFAULT NOW()
INDEX: (tenant_id, entity_type, entity_id, created_at DESC)
INDEX: (tenant_id, actor_id, created_at DESC)
```

`packages/platform-sdk/src/auditLogger.ts` (new file):
```typescript
export async function writeAuditLog(params: {
  tenantId: string;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  actorId: string;
  actorEmail: string;
  ipAddress?: string;
  db: DrizzleDB; // pass the current transaction if inside one
}): Promise<void>
```

Integrate in (at minimum):
- `InvoiceService.create()`, `confirm()`, `cancel()`
- `CustomerService.update()`
- `ItemService.update()`
- `SalesReturnService.createReturn()`

Migration: `000X_es20_audit_log.sql`

Route: `GET /api/v1/admin/audit-logs?entity=INVOICE&from=2026-07-01&to=2026-07-31&page=1&limit=50`
Guard: `authenticate` + `requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)` (defined in ES-07)

**Step 2 — Document Attachments**

`packages/platform-sdk/src/storageClient.ts` (new file or extend existing):
```typescript
export class StorageClient {
  async uploadFile(tenantId: string, prefix: string, fileName: string, buffer: Buffer, mimeType: string): Promise<string>  // returns object key
  async getSignedUrl(objectKey: string, expiresIn?: number): Promise<string>  // default 3600s
  async deleteFile(objectKey: string): Promise<void>
}
// Object key: tenant/{tenantId}/{prefix}/{timestamp}-{filename}
```

Use MinIO (local dev) / AWS S3 (production). Use `@aws-sdk/client-s3`.

`packages/db-client/src/schema/`:
New table `document_attachments`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
entity_type VARCHAR(50) NOT NULL  -- 'INVOICE' | 'PURCHASE_ORDER' | 'GRN' | 'PAYSLIP'
entity_id UUID NOT NULL
file_name VARCHAR(255) NOT NULL
object_key VARCHAR(500) NOT NULL  -- S3/MinIO key
file_size INTEGER NOT NULL        -- bytes
mime_type VARCHAR(100) NOT NULL
uploaded_by UUID NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
INDEX: (tenant_id, entity_type, entity_id)
```

API:
```
POST /api/v1/attachments (multipart form: entityType, entityId, file)
GET  /api/v1/attachments/:id/download  → redirect to signed URL
DELETE /api/v1/attachments/:id
GET  /api/v1/attachments?entityType=INVOICE&entityId=...  → list
```

Frontend: `AttachmentSection` component (reusable):
- File list with download links
- Upload button (drag-and-drop or click)
- Delete button with confirmation
- Accepted types: PDF, JPG, PNG, Excel (configured per entity type)
- Max size: 10MB

Add `AttachmentSection` to: `InvoiceDetailPage.tsx`, `PurchaseOrderDetailPage.tsx`, `GRNPage.tsx`

**Step 3 — PDF Export**

Use `@react-pdf/renderer` for server-side PDF generation OR `puppeteer` for HTML-to-PDF.

**PDF 1 — Invoice PDF:**

Route: `GET /api/v1/sales/invoices/:id/pdf`
- Render invoice as professional PDF:
  - Company letterhead (tenant name, GSTIN, address)
  - Invoice number, date, due date
  - Customer details
  - Line items table: Item, HSN, Qty, Unit Price, GST %, CGST, SGST, IGST, Total
  - GST summary table
  - Grand total in words (Indian rupee words function)
  - IRN and QR code if available (ES-11)
  - Terms and conditions (from tenant config)
- Content-Type: `application/pdf`
- Response: inline PDF (Content-Disposition: inline)

**PDF 2 — Payslip PDF:**

Route: `GET /api/v1/hr/payroll-slips/:id/pdf`
- Guard: `requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)`
- Professional payslip layout with all salary components

**PDF 3 — Report Export (P&L / Balance Sheet):**

Route: `GET /api/v1/reports/pnl/pdf?from=2026-04-01&to=2026-06-30`
- Simple tabular PDF of the P&L report

**Step 4 — Feature Flags**

`packages/db-client/src/schema/`:
New table `feature_flags`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
flag_name VARCHAR(100) NOT NULL
is_enabled BOOLEAN NOT NULL DEFAULT false
config JSONB DEFAULT '{}'
updated_by UUID
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE: (tenant_id, flag_name)
```

`packages/platform-sdk/src/featureFlags.ts` (new file):
```typescript
export async function isFeatureEnabled(
  tenantId: string,
  flagName: string,
  db: DrizzleDB,
  redis: RedisClient,
): Promise<boolean> {
  // Cache in Redis: tenant:{tenantId}:flag:{flagName} TTL 60s
  // On miss: query DB; cache result; return
  // On flag not found: return false (safe default)
}
```

Routes (admin only):
```
GET    /api/v1/admin/feature-flags         — list all flags for tenant
PUT    /api/v1/admin/feature-flags/:name   — enable/disable flag
```

Guard: `authenticate` + `requirePermission(PERMISSIONS.ADMIN_SETTINGS)`

Seed default flags for all tenants (in tenant-service seed):
```json
{ "einvoice_enabled": false, "whatsapp_enabled": false, "fifo_valuation": false, "mfa_required": false }
```

Frontend: `apps/web-frontend/src/pages/admin/FeatureFlagsPage.tsx`
- List of flags with toggle switches
- Description of each flag
- "Enable"/"Disable" button

**Step 5 — Audit Log Viewer**

`apps/web-frontend/src/pages/admin/AuditLogPage.tsx`:
- `ERPDataGrid`: Time, Entity, Action, Actor, Changed Fields
- Filters: entity type, date range, actor
- Click row → expand to see old_values vs new_values JSON diff

### OUT OF SCOPE
- External audit firm export
- SOC 2 / ISO 27001 automation
- GDPR data export / right to erasure (complex privacy workflow)
- Document OCR / parsing

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/sales-service/src/__tests__/audit-trail.test.ts`:
1. `InvoiceService.create()` → `audit_log` row with action=CREATE, entity=INVOICE
2. `InvoiceService.confirm()` → `audit_log` row with action=STATUS_CHANGE, old=DRAFT, new=CONFIRMED
3. `CustomerService.update({ email })` → `audit_log` row with changedFields=['email'], old+new values
4. Tenant isolation: audit log query for tenant A returns zero tenant B rows

`apps/` (integration):
5. Upload attachment → `document_attachments` row created; signed URL accessible
6. Download attachment → 302 redirect to signed S3 URL
7. Feature flag disabled → `isFeatureEnabled('einvoice_enabled')` returns false
8. Feature flag enabled via PUT → `isFeatureEnabled` returns true
9. `GET /admin/audit-logs` without VIEW_AUDIT_LOG permission → 403
10. `GET /api/v1/sales/invoices/:id/pdf` → Content-Type: application/pdf; non-empty body

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/platform-sdk build
pnpm --filter @erp/sales-service build
pnpm --filter @erp/hr-service build
pnpm --filter @erp/report-service build
pnpm --filter @erp/db-client build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/sales-service
pnpm test --filter @erp/platform-sdk
```

---

## ═══════════════════════════════════════════
## FINAL PRODUCTION READINESS CHECKLIST
## ═══════════════════════════════════════════

### Security
- [ ] All API routes: `authenticate` preHandler present (no anonymous routes except `/health`, `/metrics`, `/auth/login`)
- [ ] All sensitive routes: `requirePermission` present (audit by searching for `router.post/put/delete` without `requirePermission`)
- [ ] No secrets in code (grep for `password =`, `secret =`, `apiKey =` in source)
- [ ] `.env.example` has all required env var keys (no values)
- [ ] CORS: only allowed origins listed (not `*`)
- [ ] HTTP security headers: HSTS, X-Frame-Options, CSP set via `@fastify/helmet`

### Data Integrity
- [ ] Every table has `tenant_id UUID NOT NULL` (grep schema files)
- [ ] Every Drizzle query has `.where(eq(table.tenantId, ctx.tenantId))`
- [ ] Every raw SQL has `WHERE tenant_id = ${tenantId}`
- [ ] No money values stored as floats (grep for `DECIMAL` without integer conversion, or `float` types)
- [ ] Outbox pattern on all state-changing operations

### Performance
- [ ] All frequently-queried columns have indexes (ES-16)
- [ ] Health check on all services returns 200
- [ ] Redis cache in use for item and customer lookups
- [ ] No N+1 queries in list endpoints (check with query logging)

### Observability
- [ ] All services have `/metrics` Prometheus endpoint (ES-16)
- [ ] All services have `/health` endpoint (ES-16)
- [ ] Structured logging (JSON) on all services
- [ ] Audit log captures all entity changes

### Compliance
- [ ] GSTIN validation on customer/vendor create
- [ ] E-Invoice: IRN generated for applicable invoices (ES-11)
- [ ] PF/ESI calculated on each payroll run (ES-12)
- [ ] GSTR-9 data extractable (ES-10)
- [ ] Audit trail: complete record of who changed what (this phase)

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Audit log writing on all key entity changes
- [ ] Document attachment upload/download working
- [ ] Invoice PDF exports with correct layout
- [ ] Feature flag system with Redis cache
- [ ] Final production readiness checklist: all items PASS
- [ ] 10 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-20_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-20_COMPLETION.md`

```markdown
# ES-20 Completion Report — Audit, Attachments & Feature Flags
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Audit Trail
- Entities audited: INVOICE, CUSTOMER, ITEM, SALES_RETURN, [others added]
- audit_log rows written during test: [N]
- Viewer UI: /admin/audit-logs [WORKING]

## Document Attachments
- Storage backend: [MinIO / AWS S3]
- S3 bucket: [name]
- Entities with attachment support: INVOICE, PURCHASE_ORDER, GRN
- Max file size enforced: 10MB

## PDF Export
- Invoice PDF: [WORKING — tested with test invoice]
- Payslip PDF: [WORKING]
- P&L PDF: [WORKING]

## Feature Flags
- Default flags seeded: einvoice_enabled=false, whatsapp_enabled=false, fifo_valuation=false, mfa_required=false
- Redis cache TTL: 60s

## Production Readiness
- Security checklist: [N/N items PASS]
- Data integrity checklist: [N/N items PASS]
- Performance checklist: [N/N items PASS]
- Compliance checklist: [N/N items PASS]

## Files Changed
[Table]

## Tests: 10/10 PASS | lint: PASS | build: PASS

## ENTERPRISE STABILIZATION ROADMAP: ALL 20 PHASES COMPLETE ✅
**Date all phases completed:** [YYYY-MM-DD]
**Total phases:** ES-01 through ES-20
**Production readiness:** [CONFIRMED / PENDING — list any items not passing]
```
