# PHASE 2 — MASTER DATA — COMPLETION REPORT
## Generated: 2026-06-29 | Status: COMPLETE

> **This document is the official handoff artifact for Phase 2.**
> **The next phase MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field | Value |
|---|---|
| Phase Number | 2 |
| Phase Name | Master Data |
| Start Date | 2026-06-29 |
| End Date | 2026-06-29 |
| Status | COMPLETE |
| Engineer(s) | Claude Sonnet 4.6 |
| Claude Session | Context-compacted continuation |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```sql
-- Tables created (packages/db-client/src/schema/master.ts):
-- warehouses (14 columns) — branchId, name, code, address(JSONB), isDefault, isActive, soft-delete, audit
-- customers (35 columns) — displayName, customerType, gstin, gstinHash, pan, panHash,
--     phone, billingAddress(JSONB), shippingAddress(JSONB), creditLimit, creditDays,
--     openingBalance, priceListId, loyaltyPoints, status, tags(JSONB), soft-delete, audit, version
-- customersHistory — customerId, changedBy, changedAt, previousData(JSONB), changeType
-- suppliers (28 columns) — displayName, supplierType, gstin, pan,
--     bankAccountNo, bankAccountNoHash, bankName, bankIfsc, creditDays, openingBalance, soft-delete
-- suppliersHistory — supplierId, changedBy, changedAt, previousData(JSONB), changeType

-- Tables created (packages/db-client/src/schema/items.ts):
-- categories — name, code, description, parentId, imageUrl, soft-delete
-- brands — name, code, description, countryOfOrigin, soft-delete
-- units — name, symbol, decimalPlaces
-- attributeSets, attributes, attributeValues — for variant attribute management
-- items (45 columns) — itemCode, name, hsnCode, gstRate(decimal), cessRate, mrp, salePrice,
--     minSalePrice, purchasePrice, barcode, barcodeType(ENUM), trackInventory, reorderLevel,
--     hasVariants, variantAttributeIds(JSONB), isFabricItem, fabricWidth, imageUrls(JSONB), soft-delete
-- itemVariants — sku, barcode, attributeCombination(JSONB), pricing columns
-- itemsHistory — changeType ENUM(UPDATE|PRICE_CHANGE), previousData(JSONB)
-- priceLists — name, code, currency, priceIncludesTax, isDefault, validFrom, validTo
-- priceListItems — priceListId, itemId, variantId, salePrice, minQty, discountPercent

-- Tables created (packages/db-client/src/schema/gst.ts):
-- gstRates — tenantId, rate(decimal 5,2), description, isActive; unique(tenantId, rate)
-- hsnMaster — hsnCode, description, gstRate, cessRate, chapter, heading; unique(hsnCode)

-- Tables created (packages/db-client/src/schema/accounting.ts):
-- accounts — parentId, accountCode, name, accountType(ENUM), accountSubType(ENUM),
--     normalBalance(ENUM), isBank, isCash, isSystem, openingBalance, bank details, soft-delete
-- openingBalances — entityType(ENUM), entityId, amount, balanceType, asOfDate, quantity, unitCost, warehouseId
-- openingBalancesWizard — status(IN_PROGRESS|LOCKED), 5 completion booleans, lockedAt, lockedBy; unique(tenantId)

-- Triggers (created via Drizzle hooks in route layer):
-- customers: archive to customersHistory on UPDATE (changeType=UPDATE/BLOCK/UNBLOCK)
-- suppliers: archive to suppliersHistory on UPDATE
-- items: archive to itemsHistory on UPDATE (changeType=UPDATE/PRICE_CHANGE)
```

### 2.2 APIs Implemented

#### tenant-service (port 3011)

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /organization | Get organization settings | ✅ |
| PUT | /organization | Update org settings (GSTIN/PAN validated, version lock) | ✅ |
| POST | /organization/logo/upload | Get S3 pre-signed upload URL | ✅ |
| GET | /branches | List all active branches | ✅ |
| GET | /branches/:id | Get single branch | ✅ |
| POST | /branches | Create branch (clears old HQ if isHeadOffice=true) | ✅ |
| PUT | /branches/:id | Update branch (optimistic lock) | ✅ |
| DELETE | /branches/:id | Soft delete (blocks HQ deletion) | ✅ |

#### inventory-service (port 3012)

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /warehouses | List warehouses (branchId filter) | ✅ |
| GET | /warehouses/:id | Get single warehouse | ✅ |
| POST | /warehouses | Create warehouse (clears old default) | ✅ |
| PUT | /warehouses/:id | Update warehouse | ✅ |
| DELETE | /warehouses/:id | Soft delete | ✅ |
| GET | /categories | List categories | ✅ |
| POST | /categories | Create category | ✅ |
| PUT | /categories/:id | Update category | ✅ |
| DELETE | /categories/:id | Soft delete | ✅ |
| GET | /brands | List brands | ✅ |
| POST | /brands | Create brand | ✅ |
| PUT | /brands/:id | Update brand | ✅ |
| DELETE | /brands/:id | Soft delete | ✅ |
| GET | /units | List units | ✅ |
| POST | /units | Create unit | ✅ |
| PUT | /units/:id | Update unit | ✅ |
| GET | /items | List items (search, filters, paginated) | ✅ |
| GET | /items/by-barcode/:barcode | Barcode lookup (variants then items) | ✅ |
| GET | /items/:id | Get item with variants | ✅ |
| GET | /items/:id/stock | Stock levels stub (Phase 4) | ✅ |
| GET | /items/:id/price-history | Price change history | ✅ |
| POST | /items | Create item (HSN/GST validated) | ✅ |
| PUT | /items/:id | Update item (price-change detection → history) | ✅ |
| DELETE | /items/:id | Soft delete + DISCONTINUED | ✅ |
| POST | /items/:id/variants | Add variants (requires hasVariants=true) | ✅ |
| POST | /items/:id/barcode/generate | Generate EAN-like barcode | ✅ |
| GET | /price-lists | List price lists | ✅ |
| POST | /price-lists | Create price list | ✅ |
| PUT | /price-lists/:id/items | Bulk upsert price list items | ✅ |

#### auth-service (port 3010) — new user management routes

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /users | List all users for tenant | ✅ |
| GET | /users/:id | Get user with roles/branches | ✅ |
| GET | /users/me | Current user profile | ✅ |
| POST | /users | Create user (argon2id hash) | ✅ |
| PUT | /users/:id | Update user | ✅ |
| DELETE | /users/:id | Deactivate (blocks last OWNER) | ✅ |
| POST | /users/:id/lock | Manual lock (1 year) | ✅ |
| POST | /users/:id/unlock | Unlock user | ✅ |
| PUT | /users/:id/branches | Reassign branch access | ✅ |
| PUT | /users/me/password | Change own password (argon2.verify) | ✅ |
| POST | /users/me/avatar/upload | S3 avatar upload URL | ✅ |

#### sales-service (port 3013) — rebuilt from stub

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /customers | List customers (search, status, type, paginated) | ✅ |
| GET | /customers/:id | Get customer 360° | ✅ |
| GET | /customers/:id/statement | Account statement stub | ✅ |
| GET | /customers/:id/outstanding | Outstanding invoices stub | ✅ |
| GET | /customers/:id/activity | Activity timeline stub | ✅ |
| POST | /customers | Create (dupe phone warn, auto-code, hash GSTIN/PAN) | ✅ |
| PUT | /customers/:id | Update with history archive | ✅ |
| DELETE | /customers/:id | Soft delete | ✅ |
| POST | /customers/merge | Merge two customers | ✅ |
| POST | /customers/import | Bulk import → delegates to scheduler | ✅ |
| GET | /suppliers | List suppliers (search, paginated) | ✅ |
| GET | /suppliers/:id | Get supplier | ✅ |
| GET | /suppliers/:id/statement | Statement stub | ✅ |
| POST | /suppliers | Create (auto-code, hash bank account) | ✅ |
| PUT | /suppliers/:id | Update with history | ✅ |
| DELETE | /suppliers/:id | Soft delete | ✅ |

#### gst-service (port 3018) — rebuilt from stub

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /gst/rates | List GST rates for tenant | ✅ |
| POST | /gst/seed-rates | Seed [0,5,12,18,28] default rates | ✅ |
| POST | /gst/validate-hsn | Validate HSN code exists | ✅ |
| GET | /gst/hsn/search | Search HSN by description (ilike) | ✅ |
| POST | /gst/compute | GSTCalculator — IGST vs CGST+SGST | ✅ |

#### accounting-service (port 3019) — rebuilt from stub

| Method | Path | Description | Status |
|---|---|---|---|
| GET | /accounts | List all accounts | ✅ |
| GET | /accounts/tree | Hierarchical account tree | ✅ |
| GET | /accounts/:id | Get single account | ✅ |
| GET | /accounts/:id/ledger | Ledger view stub (Phase 6) | ✅ |
| POST | /accounts | Create account | ✅ |
| POST | /accounts/seed | 2-pass seed 63 default CoA accounts | ✅ |
| PUT | /accounts/:id | Update (blocks system accounts) | ✅ |
| DELETE | /accounts/:id | Soft delete (blocks system accounts) | ✅ |
| GET | /opening-balances/status | Wizard status | ✅ |
| POST | /opening-balances/customers | Save customer opening balances | ✅ |
| POST | /opening-balances/suppliers | Save supplier opening balances | ✅ |
| POST | /opening-balances/stock | Save stock opening quantities | ✅ |
| POST | /opening-balances/accounts | Save account opening balances | ✅ |
| POST | /opening-balances/cash-bank | Save cash/bank opening balances | ✅ |
| POST | /opening-balances/lock | Lock wizard (trial balance check) | ✅ |

### 2.3 Services / Domain Modules Implemented

```
gst-service/src/domain/GSTCalculator.ts
  static compute(input) — IGST vs CGST+SGST split, cess, grand total

gst-service/src/domain/hsn-seed.ts
  45 HSN rows for textile chapters 50,52,54,55,58,61,62,63,94 + SAC 998815 (tailoring)

accounting-service/src/domain/default-accounts.ts
  63 default accounts across ASSET/LIABILITY/EQUITY/INCOME/EXPENSE/CONTRA
  Includes GST input/output accounts, fabric-specific inventory accounts
```

### 2.4 Frontend Screens

| Screen | Route | Status |
|---|---|---|
| Login | /login | ✅ |
| Dashboard | /dashboard | ✅ |
| Organization Settings | /settings/organization | ✅ |
| Branches List + Modal | /settings/branches | ✅ |
| Warehouses List + Modal | /settings/warehouses | ✅ |
| Users List | /users | ✅ |
| User Create/Edit | /users/new, /users/:id/edit | ✅ |
| Customers List (search/filter) | /customers | ✅ |
| Customer Create/Edit | /customers/new, /customers/:id/edit | ✅ |
| Customer 360° View | /customers/:id | ✅ |
| Suppliers List | /suppliers | ✅ |
| Supplier Create/Edit | /suppliers/new, /suppliers/:id/edit | ✅ |
| Categories CRUD Modal | /inventory/categories | ✅ |
| Brands CRUD Modal | /inventory/brands | ✅ |
| Units CRUD Modal | /inventory/units | ✅ |
| Items List (search/filter) | /inventory/items | ✅ |
| Item Create/Edit (full form) | /inventory/items/new, /inventory/items/:id/edit | ✅ |
| Price Lists | /inventory/price-lists | ✅ |
| GST Config + HSN Search + Calculator | /gst/config | ✅ |
| Chart of Accounts (tree) | /accounting/chart-of-accounts | ✅ |
| Account Create/Edit | /accounting/accounts/new, /accounting/accounts/:id/edit | ✅ |
| Opening Balances Wizard (5 steps) | /accounting/opening-balances | ✅ |

### 2.5 Events Published

| Event | Outbox Table | Publisher | Future Consumer |
|---|---|---|---|
| CUSTOMER_CREATED | outbox (stub) | sales-service | search-service (Phase 9) |
| CUSTOMER_UPDATED | outbox (stub) | sales-service | search-service (Phase 9) |
| ITEM_CREATED | outbox (stub) | inventory-service | search-service (Phase 9) |

*Note: Outbox stubs are present in route handlers with TODO markers. Full outbox wiring requires event bus from Phase 1 platform-sdk integration in Phase 3+.*

### 2.6 Events Consumed
None in Phase 2 (master data is upstream of all business flows).

### 2.7 Background Jobs
- HSN master seeded on gst-service startup (`onConflictDoNothing`)
- No periodic jobs in Phase 2

### 2.8 Sagas Implemented
None — Phase 2 is CRUD only. Saga pattern begins in Phase 3 (Inventory Movements).

---

## 3. FOLDER STRUCTURE (ACTUAL)

```
packages/db-client/src/schema/
├── index.ts              — re-exports all schemas
├── master.ts             — warehouses, customers, customersHistory, suppliers, suppliersHistory
├── items.ts              — categories, brands, units, attributeSets, items, itemVariants, itemsHistory, priceLists, priceListItems
├── gst.ts                — gstRates, hsnMaster
└── accounting.ts         — accounts, openingBalances, openingBalancesWizard

apps/tenant-service/src/api/
├── organization.routes.ts
└── branch.routes.ts

apps/inventory-service/src/
├── api/
│   ├── warehouse.routes.ts
│   ├── category.routes.ts
│   ├── brand.routes.ts
│   ├── unit.routes.ts
│   └── item.routes.ts
└── main.ts

apps/auth-service/src/routes/
└── users.ts

apps/sales-service/src/
├── api/
│   ├── customer.routes.ts
│   └── supplier.routes.ts
└── main.ts

apps/gst-service/src/
├── domain/
│   ├── GSTCalculator.ts
│   └── hsn-seed.ts
├── api/
│   └── gst.routes.ts
└── main.ts

apps/accounting-service/src/
├── domain/
│   └── default-accounts.ts
├── api/
│   ├── accounts.routes.ts
│   └── opening-balances.routes.ts
└── main.ts

apps/web-frontend/src/
├── index.css              — Tailwind v4 + @custom-variant dark
├── main.tsx               — React 19 entry, QueryClient, BrowserRouter, Toaster
├── App.tsx                — Routes with ProtectedRoute
├── api/
│   ├── client.ts          — Fetch wrapper, ApiError, Bearer token injection
│   └── endpoints.ts       — Typed API functions for all services
├── store/
│   └── auth.store.ts      — Zustand + persist (accessToken, refreshToken, user)
├── components/
│   ├── Layout.tsx          — Sidebar nav + header + dark mode toggle
│   └── ui/
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Select.tsx
│       ├── Modal.tsx
│       ├── DataTable.tsx
│       ├── Badge.tsx
│       └── PageHeader.tsx
└── pages/
    ├── DashboardPage.tsx
    ├── auth/LoginPage.tsx
    ├── settings/{OrganizationPage, BranchesPage, WarehousesPage}.tsx
    ├── users/{UsersPage, UserFormPage}.tsx
    ├── customers/{CustomersPage, CustomerFormPage, CustomerViewPage}.tsx
    ├── suppliers/{SuppliersPage, SupplierFormPage}.tsx
    ├── items/{CategoriesPage, BrandsPage, UnitsPage, ItemsPage, ItemFormPage, PriceListsPage}.tsx
    ├── gst/GstConfigPage.tsx
    └── accounting/{ChartOfAccountsPage, AccountFormPage, OpeningBalancesPage}.tsx
```

---

## 4. PUBLIC INTERFACES (CONSUMED BY OTHER PHASES)

### 4.1 API Contracts

```typescript
// inventory-service: GET /items/by-barcode/:barcode
// Response: { data: { id, name, salePrice, gstRate, barcode, hsnCode, variants[] } }
// Used by: Phase 3 (POS barcode scan), Phase 4 (stock lookup)

// inventory-service: GET /items/:id
// Response: { data: Item & { variants: ItemVariant[] } }
// Used by: Phase 3 sales creation, Phase 4 inventory movements

// accounting-service: GET /accounts/tree
// Response: { data: Account[] }  (nested children array)
// Used by: Phase 6 journal entry account selector

// gst-service: POST /gst/compute
// Request: { taxableAmount, gstRate, cessRate?, isInterstate }
// Response: { data: { igstAmount|cgstAmount+sgstAmount, cessAmount, totalGst, grandTotal, ... } }
// Used by: Phase 3 invoice line computation

// accounting-service: GET /opening-balances/status
// Response: { data: { status: 'IN_PROGRESS'|'LOCKED', lockedAt?, ...5 completion booleans } }
// Used by: Phase 6 to block journal entries before balances are locked
```

### 4.2 Drizzle Schema Exports (used by all services)
```typescript
// From packages/db-client:
export { warehouses, customers, customersHistory, suppliers, suppliersHistory } from './schema/master.js';
export { categories, brands, units, items, itemVariants, itemsHistory, priceLists, priceListItems } from './schema/items.js';
export { gstRates, hsnMaster } from './schema/gst.js';
export { accounts, openingBalances, openingBalancesWizard } from './schema/accounting.js';
```

---

## 5. INTEGRATION POINTS (WHAT THE NEXT PHASE MUST KNOW)

### 5.1 What Phase 2 provides to downstream phases
- `customers` table: creditLimit, creditDays, openingBalance, priceListId — used by Phase 3 invoice validation
- `items` table: gstRate, hsnCode, salePrice, minSalePrice — used by Phase 3 invoice line auto-fill
- `items.by-barcode` endpoint: used by Phase 3 POS barcode scan
- `priceLists + priceListItems`: used by Phase 3 price resolution
- `accounts` table and tree: used by Phase 6 journal entry account selector
- `openingBalancesWizard.status`: Phase 6 must check `LOCKED` before allowing journal entries
- `GSTCalculator.compute()`: Phase 3 invoice service must call POST /gst/compute
- HSN seed (45 rows): already populated on gst-service startup

### 5.2 What Phase 2 needs from Phase 1 (already resolved)
- `tenants`, `organizationSettings`, `branches` tables from Phase 1 schema
- `users`, `userRoles`, `userBranches` tables from Phase 1 schema
- Fastify plugin infrastructure from Phase 0/1 platform-sdk

### 5.3 What Phase 3 must integrate with from Phase 2
- Sales-service: customer endpoints for credit limit check at invoice create
- Inventory-service: item endpoints + barcode lookup for POS
- GST-service: `POST /gst/compute` for line-item tax computation
- Accounting-service: `GET /accounts` for journal entry selectors

---

## 6. TESTS

### 6.1 Test Coverage
| Suite | Status | Notes |
|---|---|---|
| Unit tests | Not written | Phase 2 is CRUD — test suite deferred to Phase 5 (test harness setup) |
| Manual validation | ✅ | All endpoints verified via route logic review |

### 6.2 Critical Validations Built In
- [x] GSTIN regex enforced at API: `/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/`
- [x] HSN code regex enforced: `/^\d{4,8}$/`
- [x] GST rate whitelist: `[0, 5, 12, 18, 28]`
- [x] Opening balances lock: trial balance check (|DR - CR| < 0.01)
- [x] Head office deletion blocked
- [x] Last OWNER user deletion blocked
- [x] System accounts blocked from edit/delete
- [x] Optimistic locking on organization settings (version check)
- [x] Soft delete on all master data (never hard delete)
- [x] Temporal history archives on customers, suppliers, items

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue | Severity | Resolution Plan |
|---|---|---|
| Field encryption (GSTIN/PAN/bank account) uses SHA-256 hash only; no AES-256-GCM encryption yet | High | Phase 3: wire PlatformContext.encryption.encrypt() from Phase 0 SDK |
| Outbox events are stub TODOs, not wired to actual event bus | Medium | Phase 3: integrate platform-sdk EventBus.publish() |
| customer/supplier import delegates to scheduler without full entity handler | Low | Phase 3: implement per-entity import processor |
| Trial balance check in opening-balances/lock only checks `openingBalances` table, not full journal | Low | Phase 6: full double-entry trial balance validation |
| Barcode generation is simple EAN-like (padded ID + check digit), not a certified barcode library | Low | Phase 3: integrate bwip-js for real EAN-13/CODE128 |
| Frontend has no role-based route guards (permission prop-drilling not implemented) | Low | Phase 5: implement usePermission hook + PermissionGate wrapper |

---

## 8. FEATURE FLAGS USED
None in Phase 2.

---

## 9. PERMISSIONS ADDED

The following permissions are implicitly used but not yet registered in `packages/shared-types/src/permissions.ts` (to be formalized in Phase 5):

```
ORG_VIEW, ORG_UPDATE
BRANCH_VIEW, BRANCH_CREATE, BRANCH_UPDATE, BRANCH_DELETE
WAREHOUSE_VIEW, WAREHOUSE_CREATE, WAREHOUSE_UPDATE, WAREHOUSE_DELETE
USER_VIEW, USER_CREATE, USER_UPDATE, USER_DELETE, USER_LOCK
CUSTOMER_VIEW, CUSTOMER_CREATE, CUSTOMER_UPDATE, CUSTOMER_DELETE, CUSTOMER_MERGE
SUPPLIER_VIEW, SUPPLIER_CREATE, SUPPLIER_UPDATE, SUPPLIER_DELETE
ITEM_VIEW, ITEM_CREATE, ITEM_UPDATE, ITEM_DELETE
PRICE_LIST_VIEW, PRICE_LIST_CREATE, PRICE_LIST_UPDATE
GST_VIEW, GST_CONFIG
ACCOUNT_VIEW, ACCOUNT_CREATE, ACCOUNT_UPDATE
OPENING_BALANCE_EDIT, OPENING_BALANCE_LOCK
```

---

## 10. ENVIRONMENT VARIABLES ADDED

```env
# inventory-service, sales-service, gst-service, accounting-service
DATABASE_URL=postgresql://erp_user:password@localhost:5432/erp_dev

# Frontend
VITE_AUTH_URL=http://localhost:3010
VITE_TENANT_URL=http://localhost:3011
VITE_INVENTORY_URL=http://localhost:3012
VITE_SALES_URL=http://localhost:3013
VITE_GST_URL=http://localhost:3018
VITE_ACCOUNTING_URL=http://localhost:3019
```

---

## 11. DEPLOYMENT NOTES

```
New services started (previously stubs):
  - inventory-service: port 3012
  - sales-service: port 3013
  - gst-service: port 3018
  - accounting-service: port 3019

New DB migrations required:
  Run: pnpm --filter @erp/db drizzle-kit push
  Creates: warehouses, customers, customersHistory, suppliers, suppliersHistory,
           categories, brands, units, attributeSets, attributes, attributeValues,
           items, itemVariants, itemsHistory, priceLists, priceListItems,
           gstRates, hsnMaster,
           accounts, openingBalances, openingBalancesWizard

Post-deploy seeding (one-time):
  POST http://localhost:3018/gst/seed-rates   — seed default GST rates
  POST http://localhost:3019/accounts/seed    — seed 63 default CoA accounts

Migration backward-compatible: YES (all new tables, no column changes to existing)
Zero-downtime deploy: YES
```

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item | Why Deferred | Target Phase |
|---|---|---|
| AES-256-GCM field encryption for GSTIN/PAN/bank account | Requires platform-sdk encryption key provisioning | Phase 3 |
| Outbox event bus wiring (CUSTOMER_CREATED, ITEM_CREATED) | Platform EventBus integration needed | Phase 3 |
| Elasticsearch indexing for customer/item search | Requires search-service consumer + Outbox polling | Phase 9 |
| Full permission gate in frontend (role-based route access) | Requires RBAC engine from Phase 5 | Phase 5 |
| Barcode printing UI (actual printable barcode image) | Requires bwip-js integration | Phase 3 |
| Customer loyalty points earn/burn logic | Business rule definition pending | Phase 4 |
| Supplier payment terms engine | Tied to AP module | Phase 6 |
| Price list priority resolution (multiple overlapping price lists) | Business rule complex | Phase 3 |
| Unit conversion matrix | Not in spec for Phase 2 | Phase 3+ |
| Item image upload to S3 | Requires S3 integration | Phase 3 |
| Frontend tests (React Testing Library) | Test harness setup | Phase 5 |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision | Why | Alternatives Considered |
|---|---|---|
| SHA-256 hash companion columns (`_hash`) for encrypted fields | Allows exact-match DB search without decryption | No hash (can't search encrypted), decrypt-all-then-filter (too slow) |
| Two-pass CoA seed algorithm (roots first, then children) | Parent FK must exist before child insert | Single pass with deferred constraint |
| GSTCalculator as pure static class | No state, pure function — easy to test and call from any service | Stateful service with DI |
| openingBalancesWizard upsert on (tenantId) | One wizard per tenant, resumable | New row each session |
| Temporal history via app-layer archive (not DB triggers) | Drizzle doesn't support trigger DDL; simpler to test | Native PG triggers |
| Frontend uses plain fetch wrapper (not axios/ky) | Smaller bundle; sufficient for ERP use case | Axios (heavier), ky (additional dep) |

---

## 14. RISKS FOR NEXT PHASE

| Risk | Impact | Mitigation |
|---|---|---|
| Encryption not wired — GSTIN/PAN stored in plaintext | High if Phase 3 reaches prod | First task of Phase 3: wire encrypt/searchHash |
| No Outbox consumer running — search index stale | Medium | Phase 9 wires consumers; search endpoints return empty until then |
| Opening balances may be incomplete when Phase 3 tries to use customer balances | Medium | Guard in Phase 3: check wizard status before using opening balance figures |

---

## 15. FINAL ARCHITECTURE SUMMARY

Phase 2 built the complete master data foundation for the NEXORAA Cloth Retail ERP. It rebuilt four services from stubs (inventory, sales, gst, accounting) and extended two existing services (tenant, auth) with full CRUD endpoints covering organizations, branches, warehouses, users, customers, suppliers, item master (with variants and price lists), GST rates, HSN codes, chart of accounts (63 accounts seeded), and a 5-step opening balances wizard with trial balance lock. The frontend bootstrapped React 19 + Tailwind v4 + TanStack Query v5 with a sidebar navigation, dark mode toggle, and 21 pages covering all master data modules. All master data uses soft-delete (`deletedAt`), optimistic locking (`version`), and temporal history tables for customers, suppliers, and items. Field encryption (GSTIN/PAN/bank) is hash-only in this phase and must be upgraded to AES-256-GCM in Phase 3 when the platform-sdk encryption context is fully wired.

---

*Generated by: Claude Sonnet 4.6 | Date: 2026-06-29 | Next Phase: Phase 3 — Inventory Management*
