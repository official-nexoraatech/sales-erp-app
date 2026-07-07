# Report API Gap Analysis

Status as of the full reports rebuild: all report pages now call a real backend endpoint, and all
filter dropdowns are wired to live lookup data. The date-format bug that broke every date-filtered
report (frontend sent `dd/MM/yyyy`, backend expected ISO `yyyy-MM-dd`) has been fixed.

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
