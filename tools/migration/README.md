# ERP Migration Toolkit

Migrates data from legacy systems (Busy Accounting, Tally ERP, Excel) into the ERP.

## Supported Sources

| Source | Entity | Format |
|--------|--------|--------|
| Busy Accounting | customers, suppliers, items | CSV (semicolon or comma) |
| Tally ERP | customers, suppliers, items | XML (TallyPrime format) |
| Excel | all entities | `.xlsx` (use templates) |

## Quick Start

```bash
cd tools/migration
pnpm install
export DATABASE_URL="postgresql://erp:erp_password@localhost:5435/erp"

# Step 1: Generate Excel templates for clients
pnpm dev generate-templates --output=./templates

# Step 2: DRY RUN — validate without writing
pnpm dev customers --source=busy --file=./data/customers.csv --tenant=1 --mode=DRY_RUN

# Step 3: EXECUTE — write to database
pnpm dev customers --source=busy --file=./data/customers.csv --tenant=1 --mode=EXECUTE

# Step 4: Verify — reconciliation report
pnpm dev verify --tenant=1 --source-customers=500 --source-suppliers=50 --source-items=200
```

## Migration Order (MANDATORY — do not change)

1. Organization + Branches (done in ERP UI)
2. Warehouses (done in ERP UI)
3. Chart of Accounts (done in ERP UI or use defaults)
4. `erp-migrate customers`
5. `erp-migrate suppliers`
6. `erp-migrate items`
7. `erp-migrate opening-stock`
8. `erp-migrate opening-balances`
9. `erp-migrate verify` ← must pass before go-live

## Modes

| Mode | Effect |
|------|--------|
| `DRY_RUN` | Validates data, prints error report, no DB writes |
| `EXECUTE` | Writes to DB. If any row fails, logs error, continues next row |
| `VERIFY` | Counts and totals check between source and ERP |

## Reconciliation Tolerances

| Check | Tolerance |
|-------|-----------|
| Record counts | Exact (0 tolerance) |
| Customer/Supplier outstanding | ±₹10 |
| Stock value | ±₹10 per item class |
| Trial balance | Exact (DR must = CR) |

## Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_GSTIN` | GSTIN does not match 15-char format |
| `MISSING_HSN` | HSN code absent (mandatory for GST items) |
| `INVALID_GST_RATE` | GST rate not in: 0, 5, 12, 18, 28 |
| `ITEM_SKU_NOT_FOUND` | Opening stock references SKU not in items table |
| `WAREHOUSE_NOT_FOUND` | Opening stock references warehouse not in ERP |
| `TRIAL_BALANCE_MISMATCH` | DR ≠ CR in opening balances |
