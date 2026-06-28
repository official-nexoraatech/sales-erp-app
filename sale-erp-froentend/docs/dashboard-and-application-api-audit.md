# texmintra Dashboard and Application API Audit

Audit date: June 22, 2026

This document records:

- the API contract required by the redesigned dashboard;
- the APIs already available in the Spring Boot backend;
- frontend-to-backend gaps found while reviewing the application;
- authentication, authorization, response, and pagination conventions.

## 1. Common API conventions

### Base URL

```text
/api/v1
```

### Authentication

All protected requests send:

```http
Authorization: Bearer <accessToken>
Accept: application/json
Content-Type: application/json
```

The JWT contains the organization and permission context:

```json
{
  "organizationId": 4,
  "role": "Admin",
  "organizationName": "Deepak dagade",
  "permissions": ["DASHBOARD_VIEW", "SALES_VIEW", "ITEM_VIEW"],
  "userName": "skore",
  "userId": 3,
  "sub": "skore",
  "iat": 1782122867,
  "exp": 1782209267
}
```

The backend must always derive `organizationId` from the authenticated user. It must not trust an organization ID sent by the browser for organization-scoped reads.

### Success envelope

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "timestamp": "2026-06-22T12:30:00Z"
}
```

### Error envelope

```json
{
  "success": false,
  "message": "Access forbidden - insufficient permissions",
  "errorCode": "FORBIDDEN",
  "timestamp": "2026-06-22T12:30:00Z"
}
```

Recommended status codes:

| Status | Meaning |
|---|---|
| 200 | Successful read or update |
| 201 | Resource created |
| 400 | Invalid request |
| 401 | Missing, invalid, or expired token |
| 403 | Authenticated user lacks permission |
| 404 | Resource not found |
| 409 | Duplicate or invalid state transition |
| 422 | Business validation failed |
| 500 | Unexpected server error |

### Pagination

Request:

```text
?page=0&size=20&search=text&sort=createdAt,desc
```

Response data:

```json
{
  "content": [],
  "page": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 1,
  "last": true
}
```

## 2. Required dashboard API

### Current endpoint

```http
GET /api/v1/dashboard/summary
Permission: DASHBOARD_VIEW
```

The current backend response contains:

```json
{
  "todaySales": 0,
  "todayPurchase": 0,
  "todayExpense": 0,
  "todayCollection": 0,
  "cashInHand": 0,
  "bankBalance": 0,
  "stockValue": 0,
  "totalCustomers": 0,
  "totalSuppliers": 0,
  "lowStockItems": 0
}
```

This is useful but does not contain all information shown in the requested dashboard.

### Recommended consolidated contract

Keep the existing URL and extend it:

```http
GET /api/v1/dashboard/summary
```

Recommended query parameters:

| Parameter | Type | Default | Purpose |
|---|---|---:|---|
| `fromDate` | ISO date | first day of current year | Chart/report start |
| `toDate` | ISO date | current date | Chart/report end |
| `invoiceLimit` | integer | 7 | Recent invoices |
| `lowStockLimit` | integer | 7 | Low-stock rows |
| `trendingLimit` | integer | 6 | Trending items |

Required response:

```json
{
  "success": true,
  "message": "Dashboard summary retrieved successfully",
  "data": {
    "pendingSaleOrders": 3,
    "completedSaleOrders": 42,
    "paymentReceivables": 12500.00,
    "paymentPayables": 8700.00,
    "pendingPurchaseOrders": 2,
    "completedPurchaseOrders": 18,
    "totalExpense": 12600.00,
    "totalCustomers": 48,

    "todaySales": 45250.00,
    "todayPurchase": 28500.00,
    "todayExpense": 1200.00,
    "todayCollection": 32000.00,
    "cashInHand": 8500.00,
    "bankBalance": 155000.00,
    "stockValue": 1200000.00,
    "totalSuppliers": 15,
    "lowStockItems": 4,

    "saleVsPurchase": [
      {
        "period": "2026-01",
        "label": "Jan",
        "sales": 125000.00,
        "purchases": 92000.00
      }
    ],

    "trendingItems": [
      {
        "itemId": 15,
        "itemName": "Product A",
        "quantity": 48.00,
        "totalAmount": 52000.00,
        "percentage": 28.50
      }
    ],

    "recentInvoices": [
      {
        "saleId": 6,
        "invoiceDate": "2026-04-27",
        "saleCode": "SL/6",
        "customerName": "Walk in Customer",
        "grandTotal": 474.00,
        "balance": 0.00,
        "status": "PAID"
      }
    ],

    "lowStockDetails": [
      {
        "itemId": 25,
        "itemName": "qty testing",
        "brand": "",
        "category": "General",
        "minimumStock": 1.00,
        "currentStock": 0.00,
        "unit": "None"
      }
    ],

    "generatedAt": "2026-06-22T12:30:00Z"
  },
  "timestamp": "2026-06-22T12:30:00Z"
}
```

### Calculation rules

| Field | Required calculation |
|---|---|
| `pendingSaleOrders` | Sale-order records whose status is not completed/cancelled |
| `completedSaleOrders` | Sale-order records completed in the selected period |
| `paymentReceivables` | Sum of outstanding customer balances |
| `paymentPayables` | Sum of outstanding supplier balances |
| `pendingPurchaseOrders` | Purchase-order records whose status is not completed/cancelled |
| `completedPurchaseOrders` | Purchase-order records completed in the selected period |
| `totalExpense` | Expense sum in the selected period |
| `totalCustomers` | Active customers in the current organization |
| `saleVsPurchase` | Monthly sale and purchase totals |
| `trendingItems` | Top items by sold quantity, then total amount |
| `recentInvoices` | Latest non-cancelled sales invoices |
| `lowStockDetails` | Stock where `availableQty <= reorderLevel` |

All calculations must be filtered by the authenticated organization.

### Current frontend fallback behavior

Until the consolidated response is implemented, the dashboard uses:

| Dashboard section | Existing API |
|---|---|
| Financial/customer summary | `GET /api/v1/dashboard/summary` |
| Recent invoices and sale trend | `GET /api/v1/sales` |
| Purchase trend and payables | `GET /api/v1/purchases` |
| Expense fallback | `GET /api/v1/expenses` |
| Trending items | `GET /api/v1/reports/top-selling-items` |
| Low-stock table | `GET /api/v1/reports/low-stock` |

This fallback is intentionally temporary. A consolidated dashboard endpoint is faster, consistent, and avoids six independent database/API requests.

## 3. Existing backend endpoint inventory

The following controllers were found in the backend.

### Authentication and authorization

| Method | Endpoint | Permission/status |
|---|---|---|
| POST | `/api/v1/auth/login` | Public |
| GET | `/api/v1/permissions/groups` | Permission administration |
| GET | `/api/v1/permissions/all` | Permission administration |
| GET | `/api/v1/permissions/group/{groupName}` | Permission administration |
| GET | `/api/v1/permissions/{permissionName}` | Permission administration |
| GET | `/api/v1/permissions/stats/summary` | Permission administration |

### Dashboard

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/v1/dashboard/summary` | `DASHBOARD_VIEW` |

### Organizations, users, and roles

| Method | Endpoint |
|---|---|
| POST/GET | `/api/v1/organizations` |
| GET/PUT/DELETE | `/api/v1/organizations/{id}` |
| POST | `/api/v1/organizations/{id}/logo` |
| POST/GET | `/api/v1/users` |
| PUT/DELETE | `/api/v1/users/{id}` |
| GET | `/api/v1/users/profile` |
| PUT | `/api/v1/users/update-profile` |
| PUT | `/api/v1/users/change-password` |
| POST | `/api/v1/users/{id}/profile-image` |
| POST/GET | `/api/v1/roles` |
| GET | `/api/v1/roles/organization/{organizationId}` |
| GET/PUT/DELETE | `/api/v1/roles/{id}` |

### Contacts

| Module | Endpoints |
|---|---|
| Customers | `POST/GET /customers`, `GET/PUT/DELETE /customers/{id}`, `GET /customers/{id}/ledger` |
| Suppliers | `POST/GET /suppliers`, `GET/PUT/DELETE /suppliers/{id}`, `GET /suppliers/{id}/ledger` |
| Carriers | `POST/GET /carriers`, `GET/PUT/DELETE /carriers/{id}` |
| Contact import | `GET /contacts/excel/template`, `POST /contacts/excel/import` |

### Items and inventory masters

| Module | Endpoints |
|---|---|
| Items | `POST/GET /items`, `GET/PUT/DELETE /items/{id}`, `GET /items/{id}/stock` |
| Item import | `GET /items/excel/template`, `POST /items/excel/import` |
| Categories | `POST/GET /categories`, `PUT/DELETE /categories/{id}` |
| Brands | `POST/GET /brands`, `GET /brands/category/{categoryId}`, `PUT/DELETE /brands/{id}` |
| Units | `POST/GET /units`, `GET/PUT/DELETE /units/{id}` |
| Warehouses | `POST/GET /warehouses`, `PUT/DELETE /warehouses/{id}` |
| Stock transfers | `POST/GET /stocks/transfers`, `GET /stocks/transfers/{id}` |
| Stock adjustments | `POST/GET /stocks/adjustments`, `GET /stocks/adjustments/{id}` |

### Sales and purchasing

| Module | Endpoints |
|---|---|
| Sales invoices | `POST/GET /sales`, `GET/PUT /sales/{id}`, `PUT /sales/{id}/cancel`, `GET /sales/{id}/invoice` |
| POS | `POST /pos/billing` |
| Sales returns | `POST/GET /sales-returns`, `GET /sales-returns/{id}` |
| Purchases | `POST/GET /purchases`, `GET/PUT /purchases/{id}`, `PUT /purchases/{id}/cancel` |
| Purchase returns | `POST/GET /purchase-returns`, `GET /purchase-returns/{id}` |
| Payment in | `POST/GET /payment-in`, `GET /payment-in/{id}` |
| Payment out | `POST/GET /payment-out`, `GET /payment-out/{id}` |

### Expenses, cash, and bank

| Module | Endpoints |
|---|---|
| Expenses | `POST/GET /expenses`, `GET/PUT/DELETE /expenses/{id}` |
| Cash | `GET /cash/summary`, `GET /cash/transactions` |
| Bank accounts | `POST/GET /bank-accounts`, `GET /bank-accounts/{id}/transactions` |

### Reports

| Method | Endpoint |
|---|---|
| GET | `/api/v1/reports/sales?fromDate&toDate` |
| GET | `/api/v1/reports/purchases?fromDate&toDate` |
| GET | `/api/v1/reports/stocks` |
| GET | `/api/v1/reports/low-stock` |
| GET | `/api/v1/reports/customer-ledger/{customerId}` |
| GET | `/api/v1/reports/supplier-ledger/{supplierId}` |
| GET | `/api/v1/reports/profit-loss?fromDate&toDate` |
| GET | `/api/v1/reports/gst?fromDate&toDate` |
| GET | `/api/v1/reports/inventory-valuation` |
| GET | `/api/v1/reports/top-selling-items` |
| GET | `/api/v1/reports/day-book?date` |

### Staff management

| Module | Endpoints |
|---|---|
| Employees | `GET/POST /staff/employees`, `GET/PUT/DELETE /staff/employees/{id}` |
| Documents | `POST/GET /staff/employees/{id}/documents`, `DELETE /staff/employees/{id}/documents/{documentId}` |
| Attendance | `GET/POST /staff/attendance`, `PUT /staff/attendance/{id}`, `GET /staff/attendance/summary` |
| Leaves | `GET/POST /staff/leaves`, approve/reject/cancel endpoints, `GET /staff/leaves/balance` |
| Payroll | `GET/POST /staff/payroll`, `GET /staff/payroll/{id}`, `PUT /staff/payroll/{id}/mark-paid` |
| Staff settings | CRUD under `/staff/settings/{type}` |

### Communication and location

| Module | Endpoints |
|---|---|
| SMS | Template CRUD and `POST /sms/send` |
| Email | Template CRUD and `POST /email/send` |
| Countries | `GET /countries` |
| States | `GET /states?countryId={id}` |

## 4. Important application gaps

### Separate order modules are missing

The frontend currently presents “Sale Orders” using the sales invoice API and “Purchase Orders” using the purchase bill API. These are not separate order workflows.

Required backend resources:

```text
POST/GET /api/v1/sale-orders
GET/PUT /api/v1/sale-orders/{id}
PUT /api/v1/sale-orders/{id}/complete
PUT /api/v1/sale-orders/{id}/cancel

POST/GET /api/v1/purchase-orders
GET/PUT /api/v1/purchase-orders/{id}
PUT /api/v1/purchase-orders/{id}/complete
PUT /api/v1/purchase-orders/{id}/cancel
```

Without these APIs, dashboard pending/completed order counts can only be approximated from invoice/bill status.

### UI routes without dedicated backend controllers

The current frontend includes screens for which no matching dedicated controller was found:

- quotations;
- cheques;
- expense categories and subcategories;
- separate sale orders;
- separate purchase orders;
- some report variants such as batch/serial-specific report routes;
- cash adjustment/delete operations;
- message-template behavior currently duplicated between frontend placeholders and backend SMS/email controllers.

These screens should either receive dedicated APIs or be hidden until their backend contracts exist.

### Permission alignment

Every frontend route and action should use the same permission name declared in `permissions-config.yaml`. The backend must still enforce permissions; hiding a frontend button is only a usability measure.

Dashboard-related permissions:

```text
DASHBOARD_VIEW
SALES_VIEW
PURCHASE_VIEW
EXPENSE_VIEW
REPORT_LOW_STOCK_VIEW
REPORT_TOP_SELLING_ITEMS_VIEW
```

The recommended consolidated dashboard response should require only `DASHBOARD_VIEW`, because its service performs server-side aggregation and does not expose unrestricted module data.

## 5. Recommended delivery order

1. Extend `GET /api/v1/dashboard/summary` with the consolidated contract.
2. Implement real sale-order and purchase-order modules.
3. Add integration tests proving organization isolation.
4. Add permission tests for every protected endpoint.
5. Implement APIs for quotations, cheques, and expense masters.
6. Replace remaining frontend placeholder actions with real endpoint calls.
7. Publish the generated OpenAPI document at `/swagger-ui.html` as the authoritative endpoint reference.

