# Report API Gap Analysis

Status as of the full reports rebuild: all report pages now call a real backend endpoint, and all
filter dropdowns are wired to live lookup data. The date-format bug that broke every date-filtered
report (frontend sent `dd/MM/yyyy`, backend expected ISO `yyyy-MM-dd`) has been fixed.

## Post-rebuild QA pass (functional testing fixes)

End-to-end testing (fresh org, real sale/purchase/expense data, browser verification) surfaced and
fixed the following:

- **Stale hardcoded default date filters**: `ReportPage.tsx` and `ProfitLossReportPage.tsx` defaulted
  every date-range filter to a fixed leftover date (`2026-05-30` / `2026-05-01`). Any data created
  after that date was invisible until the user manually changed the filter, making every
  date-filtered report look broken/empty by default. Now defaults to "start of current month → today",
  computed at render time.
- **`unwrapRows` didn't handle summary-wrapped list responses**: `GET /reports/sales` and
  `GET /reports/purchases` return `{ totalSales, invoiceCount, records: [...] }`, but the frontend's
  row-unwrapping helper only recognized `content` / `items` / `transactions` array keys, so it fell
  back to treating the whole summary object as a single blank row. Sale, Item Sale, Purchase, and
  Item Purchase reports showed a phantom empty row instead of real data. Fixed by also unwrapping
  `data.records`.
- **GST/GSTR-1/GSTR-2 backend shape mismatch**: `GET /reports/gst` returned one aggregate totals
  object, but the report pages render an invoice-level table (date, invoice no., party, GSTIN,
  taxable amount, tax amount, total). The endpoint now returns one entry per sale invoice in range
  (`GstReportResponseDto` is a per-invoice line, not an aggregate).
- **Customer creation 500 when `isWholesale` omitted**: `CustomerMapper` mapped `isWholesale`
  straight through with no default, so an omitted/null value hit the `contacts.is_wholesale NOT NULL`
  constraint and returned a raw Postgres error to the API caller. Fixed with a MapStruct
  `defaultValue = "false"` on both create and update mappings.
- **Raw SQL/DB errors leaked to API clients**: `GlobalExceptionHandler` returned the root-cause
  exception message (including internal SQL/column detail) for `DataIntegrityViolationException`,
  Hibernate `ConstraintViolationException`, and generic `DataAccessException`/`PersistenceException`.
  Now returns a generic, safe message while the full detail is still logged server-side.

## Backend Endpoints In Use

- Sales Report: `GET /api/v1/reports/sales`
- Item Sales Report: reuses `GET /api/v1/reports/sales`
- Purchase Report: `GET /api/v1/reports/purchases`
- Item Purchase Report: reuses `GET /api/v1/reports/purchases`
- Supplier Ledger: `GET /api/v1/reports/supplier-ledger/{supplierId}`
- Customer Ledger: `GET /api/v1/reports/customer-ledger/{customerId}`
- Customer Due Payment Report: `GET /api/v1/reports/customer-dues`
- Supplier Due Payment Report: `GET /api/v1/reports/supplier-dues`
- Purchase Payment Report: `GET /api/v1/reports/purchase-payments`
- Sale Payment Report: `GET /api/v1/reports/sale-payments`
- Expense Report / Expense Item Report / Expense Payment Report: `GET /api/v1/expenses`,
  `GET /api/v1/reports/expense-items`, `GET /api/v1/reports/expense-payments`
- Bank Statement: `GET /api/v1/reports/bank-statement`
- Cash flow: `GET /api/v1/cash/transactions`
- GST / GSTR-1 / GSTR-2: `GET /api/v1/reports/gst`
- Profit and Loss: `GET /api/v1/reports/profit-loss` (now computed from real sale/purchase/return/
  expense data — see limitations below for the shipping-charge line)
- Stock Report / Batch Wise / Serial-IMEI / General Stock: `GET /api/v1/reports/stocks`
- Low Stock / Reorder Item: `GET /api/v1/reports/low-stock`
- Inventory Valuation: `GET /api/v1/reports/inventory-valuation`
- Top Selling Items: `GET /api/v1/reports/top-selling-items`
- Day Book: `GET /api/v1/reports/day-book`
- Batch/Serial/General Transaction Reports: `GET /api/v1/reports/item-transactions/batch`,
  `/serial`, `/general`
- Expired Item Report: `GET /api/v1/reports/expired-items`
- Stock Transfer Report / Item Stock Transfer Report: `GET /api/v1/stocks/transfers`
- Stock Adjustment Report / Item Stock Adjustment Report: `GET /api/v1/stocks/adjustments`

## Lookup APIs Wired Into Filters

`ReportPage.tsx` now loads customers, suppliers, items, brands, categories, expense
sub-categories, warehouses, payment methods, and bank accounts via `useQuery` and populates the
matching `<select>` filters (previously placeholder-only, unwired).

## Known Schema Limitations (Accepted, No Migration)

These were confirmed with the product owner and intentionally left as-is rather than requiring a
database migration:

- **Serial/IMEI tracking**: the schema only tracks batches (`ItemBatch.batchNo`), not individual
  serial numbers/IMEIs. `GET /api/v1/reports/item-transactions/serial` responds correctly but
  always returns an empty list.
- **Expense granularity**: `Expense` is a single row (category + amount) with no sub-category link
  and no per-line items. Expense Item and Expense Payment reports both report at the
  expense-category level using the same underlying data.
- **Shipping charge**: `Sale`/`Purchase` have no shipping-charge column. The Profit & Loss
  "Shipping Charge" line is always reported as zero.
