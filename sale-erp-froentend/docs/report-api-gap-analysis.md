# Report API Gap Analysis

## APIs Provided And Integrated

These report pages are connected to provided APIs:

- Profit and Loss: `GET /api/v1/reports/profit-loss`
- Purchase Report: `GET /api/v1/reports/purchases`
- Item Purchase Report: reuses `GET /api/v1/reports/purchases`
- Sale Report: `GET /api/v1/reports/sales`
- Item Sale Report: reuses `GET /api/v1/reports/sales`
- Supplier Ledger: `GET /api/v1/reports/supplier-ledger/{supplierId}`
- Customer Ledger: `GET /api/v1/reports/customer-ledger/{customerId}`
- GST / GSTR-1 / GSTR-2: `GET /api/v1/reports/gst`
- Stock Report / Batch Wise / Serial-IMEI / General Stock: `GET /api/v1/reports/stocks`
- Low Stock / Reorder Item: `GET /api/v1/reports/low-stock`
- Inventory Valuation: `GET /api/v1/reports/inventory-valuation`
- Top Selling Items: `GET /api/v1/reports/top-selling-items`
- Day Book: `GET /api/v1/reports/day-book`

## Existing Non-Report APIs Reused

These pages are connected using existing module APIs because no report-specific endpoint was provided:

- Expense Report: `GET /api/v1/expenses`
- Cash flow: `GET /api/v1/cash/transactions`
- Stock Transfer Report: `GET /api/v1/stocks/transfers`
- Item Stock Transfer Report: `GET /api/v1/stocks/transfers`
- Stock Adjustment Report: `GET /api/v1/stocks/adjustments`
- Item Stock Adjustment Report: `GET /api/v1/stocks/adjustments`

## Design Complete, Backend API Still Required

These screens are implemented visually but need dedicated backend APIs for correct data:

### Due Payment Reports

`GET /api/v1/reports/customer-dues?customerId=`

`GET /api/v1/reports/supplier-dues?supplierId=`

### Expense Item And Payment Reports

`GET /api/v1/reports/expense-items?fromDate=&toDate=&categoryId=&subCategoryId=&itemId=`

`GET /api/v1/reports/expense-payments?fromDate=&toDate=&categoryId=&subCategoryId=&paymentMethodId=`

### Purchase/Sale Payment Reports

`GET /api/v1/reports/purchase-payments?fromDate=&toDate=&supplierId=&paymentMethodId=`

`GET /api/v1/reports/sale-payments?fromDate=&toDate=&customerId=&paymentMethodId=`

### Bank Statement

`GET /api/v1/reports/bank-statement?fromDate=&toDate=&bankAccountId=`

### Item Transaction Reports

`GET /api/v1/reports/item-transactions/batch?fromDate=&toDate=&itemId=&brandId=&batchNo=&warehouseId=`

`GET /api/v1/reports/item-transactions/serial?fromDate=&toDate=&itemId=&brandId=&serialImei=&warehouseId=`

`GET /api/v1/reports/item-transactions/general?fromDate=&toDate=&itemId=&brandId=&warehouseId=`

### Expired Item Report

`GET /api/v1/reports/expired-items?filterType=&fromDate=&toDate=&itemId=&brandId=&batchNo=&warehouseId=`

## Lookup APIs Required For Proper Dropdowns

The current report filters show design placeholders where lookup APIs are missing.

Required dropdown APIs:

- `GET /api/v1/customers?page=0&size=100&search=`
- `GET /api/v1/suppliers?page=0&size=100&search=`
- `GET /api/v1/items?page=0&size=100&search=`
- `GET /api/v1/brands?search=`
- `GET /api/v1/categories?search=`
- `GET /api/v1/warehouses?search=`
- `GET /api/v1/payment-methods`
- `GET /api/v1/bank-accounts`
