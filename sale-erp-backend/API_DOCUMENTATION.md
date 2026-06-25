# BillTop API Documentation and Local Test Report

Generated: 2026-06-03T11:32:39.251Z
OpenAPI: BillTop REST API (3.1.0)
Requested base URL: `http://localhost:8080`
Tested base URL: `http://localhost:8081`
Swagger/OpenAPI JSON tested from: `http://localhost:8081/v3/api-docs`
Operations discovered: 93
Test run ID: `20260603113236057`

## Important Findings

- `http://localhost:8080` was not reachable. The running Spring Boot app listens on `8081`, matching `server.port=8081` in `application.properties`.
- OpenAPI declares global Bearer security for every operation, but Spring Security permits `/api/v1/auth/**`, `POST /api/v1/users`, and `POST /api/v1/organizations` without authentication.
- `payment_methods`, `expense_categories`, and `cash_accounts` had no rows before testing. Payment, POS, and expense create APIs cannot succeed through HTTP without lookup seed data or lookup CRUD APIs.
- Most create endpoints return `ApiResponseDto<Void>` with only success/message/timestamp. Clients must do a follow-up search to find the created ID; returning the created ID or a `Location` header would make the API easier to consume.
- `GET /api/v1/cash/summary` and `GET /api/v1/dashboard/summary` return HTTP 500 when no cash account exists. `FinanceSupport.cashSummary()` attempts to create a cash account inside read-only service methods.
- DELETE and cancel APIs were not executed because they delete/deactivate records or reverse stock/ledger state.

## Result Summary

| Metric | Count |
|---|---:|
| Passed | 72 |
| Expected failures | 10 |
| Failed | 0 |
| Skipped | 11 |
| Not run | 0 |

## Authentication

- Login endpoint: `POST /api/v1/auth/login`.
- Token field: `data.accessToken`.
- Secured request header: `Authorization: Bearer <JWT_TOKEN>`.
- Standard secured error response observed without token:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

## Endpoint Details

### login

- API Name: login
- Operation ID: `login`
- Tag: `auth-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/auth/login`
- Auth Required: No
- Request Schema: `#/components/schemas/LoginRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoLoginResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "userName": "deepakdagade",
  "password": "<redacted>"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/auth/login' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"userName":"deepakdagade","password":"<redacted>"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "<redacted>",
    "tokenType": "Bearer",
    "userName": "deepakdagade",
    "organizationId": 1,
    "organizationName": "Default Organization",
    "organizationLogoUrl": null,
    "role": "Admin",
    "permissions": [
      "VIEW_REPORTS"
    ]
  },
  "timestamp": "2026-06-03T17:02:36.5769126"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Validation failed",
  "errorCode": "VALIDATION_FAILED",
  "data": {
    "field": "reason"
  },
  "timestamp": "<timestamp>"
}
```

### getBankAccounts

- API Name: getBankAccounts
- Operation ID: `getBankAccounts`
- Tag: `bank-account-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/bank-accounts`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListBankAccountResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/bank-accounts' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Bank accounts retrieved successfully",
  "data": [
    {
      "bankAccountId": 2,
      "bankName": "API Test Bank",
      "accountName": "API Test Account 20260603113236057",
      "accountNumber": "AC20260603113236057",
      "ifscCode": "TEST0001234",
      "branchName": "API Test Branch",
      "openingBalance": 0,
      "currentBalance": 0
    },
    {
      "bankAccountId": 1,
      "bankName": "API Test Bank",
      "accountName": "API Test Account 20260603113021506",
      "accountNumber": "AC20260603113021506",
      "ifscCode": "TEST0001234",
      "branchName": "API Test Branch",
      "openingBalance": 0,
      "currentBalance": 0
    }
  ],
  "timestamp": "2026-06-03T17:02:38.5052712"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createBankAccount

- API Name: createBankAccount
- Operation ID: `createBankAccount`
- Tag: `bank-account-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/bank-accounts`
- Auth Required: Yes
- Request Schema: `#/components/schemas/BankAccountRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "bankName": "API Test Bank",
  "accountName": "API Test Account 20260603113236057",
  "accountNumber": "AC20260603113236057",
  "ifscCode": "TEST0001234",
  "branchName": "API Test Branch",
  "openingBalance": 0
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/bank-accounts' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"bankName":"API Test Bank","accountName":"API Test Account 20260603113236057","accountNumber":"AC20260603113236057","ifscCode":"TEST0001234","branchName":"API Test Branch","openingBalance":0}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Bank account created successfully",
  "timestamp": "2026-06-03T17:02:37.2562712"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getBankTransactions

- API Name: getBankTransactions
- Operation ID: `getBankTransactions`
- Tag: `bank-account-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/bank-accounts/2/transactions`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoBankLedgerResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/bank-accounts/2/transactions' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Bank transactions retrieved successfully",
  "data": {
    "currentBalance": 0,
    "transactions": []
  },
  "timestamp": "2026-06-03T17:02:38.5186217"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getBrands

- API Name: getBrands
- Operation ID: `getBrands`
- Tag: `brand-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/brands?search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListBrandResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/brands?search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Brands retrieved successfully",
  "data": [
    {
      "id": 3,
      "name": "API Test Brand 20260603113021506",
      "description": "Created by API documentation test",
      "status": true
    },
    {
      "id": 4,
      "name": "API Test Brand 20260603113236057 Updated",
      "description": "Updated by API documentation test",
      "status": true
    }
  ],
  "timestamp": "2026-06-03T17:02:38.4433776"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createBrand

- API Name: createBrand
- Operation ID: `createBrand`
- Tag: `brand-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/brands`
- Auth Required: Yes
- Request Schema: `#/components/schemas/BrandRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Brand 20260603113236057",
  "description": "Created by API documentation test"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/brands' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Brand 20260603113236057","description":"Created by API documentation test"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Brand created successfully",
  "timestamp": "2026-06-03T17:02:36.9255654"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteBrand

- API Name: deleteBrand
- Operation ID: `deleteBrand`
- Tag: `brand-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/brands/4`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/brands/4' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateBrand

- API Name: updateBrand
- Operation ID: `updateBrand`
- Tag: `brand-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/brands/4`
- Auth Required: Yes
- Request Schema: `#/components/schemas/BrandRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Brand 20260603113236057 Updated",
  "description": "Updated by API documentation test"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/brands/4' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Brand 20260603113236057 Updated","description":"Updated by API documentation test"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Brand updated successfully",
  "timestamp": "2026-06-03T17:02:36.9844201"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSummary_1

- API Name: getSummary_1
- Operation ID: `getSummary_1`
- Tag: `cash-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/cash/summary`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoCashSummaryResponseDto`
- Test Result: EXPECTED FAILURE: HTTP 500
- Notes/Fixes: Fails with 500. Source cause: CashServiceImpl.getSummary is readOnly but FinanceSupport.cashSummary can insert a CashAccount via getOrCreateCashAccount when none exists.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/cash/summary' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoCashSummaryResponseDto",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Internal server error",
  "errorCode": "INTERNAL_SERVER_ERROR",
  "timestamp": "2026-06-03T17:02:39.0163141"
}
```

### getTransactions

- API Name: getTransactions
- Operation ID: `getTransactions`
- Tag: `cash-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/cash/transactions`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListCashTransactionResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/cash/transactions' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Cash transactions retrieved successfully",
  "data": [],
  "timestamp": "2026-06-03T17:02:39.0320641"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getCategories

- API Name: getCategories
- Operation ID: `getCategories`
- Tag: `category-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/categories?search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListCategoryResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/categories?search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Categories retrieved successfully",
  "data": [
    {
      "id": 2,
      "name": "API Test Category 20260603113021506",
      "description": "Created by API documentation test",
      "status": true
    },
    {
      "id": 3,
      "name": "API Test Category 20260603113236057 Updated",
      "description": "Updated by API documentation test",
      "status": true
    }
  ],
  "timestamp": "2026-06-03T17:02:38.4590517"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createCategory

- API Name: createCategory
- Operation ID: `createCategory`
- Tag: `category-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/categories`
- Auth Required: Yes
- Request Schema: `#/components/schemas/CategoryRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Category 20260603113236057",
  "description": "Created by API documentation test"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/categories' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Category 20260603113236057","description":"Created by API documentation test"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Category created successfully",
  "timestamp": "2026-06-03T17:02:37.0157036"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteCategory

- API Name: deleteCategory
- Operation ID: `deleteCategory`
- Tag: `category-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/categories/3`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/categories/3' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateCategory

- API Name: updateCategory
- Operation ID: `updateCategory`
- Tag: `category-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/categories/3`
- Auth Required: Yes
- Request Schema: `#/components/schemas/CategoryRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Category 20260603113236057 Updated",
  "description": "Updated by API documentation test"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/categories/3' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Category 20260603113236057 Updated","description":"Updated by API documentation test"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Category updated successfully",
  "timestamp": "2026-06-03T17:02:37.0626104"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getCustomers

- API Name: getCustomers
- Operation ID: `getCustomers`
- Tag: `customer-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/customers?page=0&size=5&search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoCustomerListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  },
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/customers?page=0&size=5&search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Customers retrieved successfully",
  "data": {
    "content": [
      {
        "id": 5,
        "customerCode": "CUS000005",
        "customerName": "Api Customer",
        "mobile": "9113236057",
        "balance": 0
      },
      {
        "id": 3,
        "customerCode": "CUS000003",
        "customerName": "Api Customer",
        "mobile": "9113021506",
        "balance": 0
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 2,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.5430218"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createCustomer

- API Name: createCustomer
- Operation ID: `createCustomer`
- Tag: `customer-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/customers`
- Auth Required: Yes
- Request Schema: `#/components/schemas/CustomerRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "firstName": "Api",
  "lastName": "Customer",
  "email": "apitest.customer.20260603113236057@example.com",
  "phone": "0200000000",
  "mobile": "9113236057",
  "whatsappNo": "9113236057",
  "gstNumber": "",
  "panNumber": "",
  "creditLimit": 1000,
  "openingBalance": 0,
  "openingBalanceType": "RECEIVABLE",
  "isWholesale": false,
  "billingAddress": {
    "addressLine1": "API Test Address Line 1",
    "addressLine2": "API Test Address Line 2",
    "city": "Pune",
    "stateId": 1,
    "countryId": 1,
    "pincode": "411001"
  },
  "shippingAddress": {
    "addressLine1": "API Test Address Line 1",
    "addressLine2": "API Test Address Line 2",
    "city": "Pune",
    "stateId": 1,
    "countryId": 1,
    "pincode": "411001"
  }
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/customers' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"firstName":"Api","lastName":"Customer","email":"apitest.customer.20260603113236057@example.com","phone":"0200000000","mobile":"9113236057","whatsappNo":"9113236057","gstNumber":"","panNumber":"","creditLimit":1000,"openingBalance":0,"openingBalanceType":"RECEIVABLE","isWholesale":false,"billingAddress":{"addressLine1":"API Test Address Line 1","addressLine2":"API Test Address Line 2","city":"Pune","stateId":1,"countryId":1,"pincode":"411001"},"shippingAddress":{"addressLine1":"API Test Address Line 1","addressLine2":"API Test Address Line 2","city":"Pune","stateId":1,"countryId":1,"pincode":"411001"}}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Customer created successfully",
  "timestamp": "2026-06-03T17:02:37.3328293"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteCustomer

- API Name: deleteCustomer
- Operation ID: `deleteCustomer`
- Tag: `customer-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/customers/5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/customers/5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getCustomerById

- API Name: getCustomerById
- Operation ID: `getCustomerById`
- Tag: `customer-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/customers/5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoCustomerDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/customers/5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Customer retrieved successfully",
  "data": {
    "id": 5,
    "customerCode": "CUS000005",
    "firstName": "Api",
    "lastName": "Customer",
    "email": "apitest.customer.20260603113236057@example.com",
    "phone": "0200000001",
    "mobile": "9113236057",
    "whatsappNo": "9113236057",
    "gstNumber": "",
    "panNumber": "",
    "creditLimit": 1000,
    "openingBalance": 0,
    "openingBalanceType": "RECEIVABLE",
    "isWholesale": false,
    "currentBalance": 0,
    "billingAddress": {
      "id": 5,
      "addressType": "BILLING",
      "addressLine1": "API Test Address Line 1",
      "addressLine2": "API Test Address Line 2",
      "city": "Pune",
      "stateId": 1,
      "stateName": "Maharashtra",
      "countryId": 1,
      "countryName": "India",
      "pincode": "411001"
    },
    "shippingAddress": {
      "id": 6,
      "addressType": "SHIPPING",
      "addressLine1": "API Test Address Line 1",
      "addressLine2": "API Test Address Line 2",
      "city": "Pune",
      "stateId": 1,
      "stateName": "Maharashtra",
      "countryId": 1,
      "countryName": "India",
      "pincode": "411001"
    }
  },
  "timestamp": "2026-06-03T17:02:38.5638617"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateCustomer

- API Name: updateCustomer
- Operation ID: `updateCustomer`
- Tag: `customer-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/customers/5`
- Auth Required: Yes
- Request Schema: `#/components/schemas/CustomerRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "firstName": "Api",
  "lastName": "Customer",
  "email": "apitest.customer.20260603113236057@example.com",
  "phone": "0200000001",
  "mobile": "9113236057",
  "whatsappNo": "9113236057",
  "gstNumber": "",
  "panNumber": "",
  "creditLimit": 1000,
  "openingBalance": 0,
  "openingBalanceType": "RECEIVABLE",
  "isWholesale": false,
  "billingAddress": {
    "addressLine1": "API Test Address Line 1",
    "addressLine2": "API Test Address Line 2",
    "city": "Pune",
    "stateId": 1,
    "countryId": 1,
    "pincode": "411001"
  },
  "shippingAddress": {
    "addressLine1": "API Test Address Line 1",
    "addressLine2": "API Test Address Line 2",
    "city": "Pune",
    "stateId": 1,
    "countryId": 1,
    "pincode": "411001"
  }
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/customers/5' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"firstName":"Api","lastName":"Customer","email":"apitest.customer.20260603113236057@example.com","phone":"0200000001","mobile":"9113236057","whatsappNo":"9113236057","gstNumber":"","panNumber":"","creditLimit":1000,"openingBalance":0,"openingBalanceType":"RECEIVABLE","isWholesale":false,"billingAddress":{"addressLine1":"API Test Address Line 1","addressLine2":"API Test Address Line 2","city":"Pune","stateId":1,"countryId":1,"pincode":"411001"},"shippingAddress":{"addressLine1":"API Test Address Line 1","addressLine2":"API Test Address Line 2","city":"Pune","stateId":1,"countryId":1,"pincode":"411001"}}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Customer updated successfully",
  "timestamp": "2026-06-03T17:02:37.3944331"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getCustomerLedger_1

- API Name: getCustomerLedger_1
- Operation ID: `getCustomerLedger_1`
- Tag: `customer-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/customers/5/ledger`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoLedgerResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/customers/5/ledger' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Customer ledger retrieved successfully",
  "data": {
    "openingBalance": 0,
    "transactions": [
      {
        "date": "2026-06-03",
        "type": "SALE",
        "referenceNo": "INV-000001",
        "debit": 75,
        "credit": 0,
        "balance": 75
      },
      {
        "date": "2026-06-03",
        "type": "SALES_RETURN",
        "referenceNo": "SR-000001",
        "debit": 0,
        "credit": 75,
        "balance": 0
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.5869336"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSummary

- API Name: getSummary
- Operation ID: `getSummary`
- Tag: `dashboard-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/dashboard/summary`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoDashboardSummaryResponseDto`
- Test Result: EXPECTED FAILURE: HTTP 500
- Notes/Fixes: Fails with 500 for the same cash account readOnly insert path used by financeSupport.totalCashBalance().

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/dashboard/summary' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoDashboardSummaryResponseDto",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Internal server error",
  "errorCode": "INTERNAL_SERVER_ERROR",
  "timestamp": "2026-06-03T17:02:39.0589178"
}
```

### getExpenses

- API Name: getExpenses
- Operation ID: `getExpenses`
- Tag: `expense-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/expenses?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoExpenseResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/expenses?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Expenses retrieved successfully",
  "data": {
    "content": [],
    "page": 0,
    "size": 5,
    "totalElements": 0,
    "totalPages": 0,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.949124"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createExpense

- API Name: createExpense
- Operation ID: `createExpense`
- Tag: `expense-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/expenses`
- Auth Required: Yes
- Request Schema: `#/components/schemas/ExpenseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: Fails because expense_categories and payment_methods lookup rows are absent and no HTTP lookup API is exposed.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "expenseCategoryId": 1,
  "expenseDate": "2026-06-03",
  "amount": 10,
  "paymentMethodId": 1,
  "notes": "API documentation test expense"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/expenses' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"expenseCategoryId":1,"expenseDate":"2026-06-03","amount":10,"paymentMethodId":1,"notes":"API documentation test expense"}'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Expense category not found",
  "errorCode": "EXPENSE_CATEGORY_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.3338049"
}
```

### deleteExpense

- API Name: deleteExpense
- Operation ID: `deleteExpense`
- Tag: `expense-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/expenses/999999999`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/expenses/999999999' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getExpenseById

- API Name: getExpenseById
- Operation ID: `getExpenseById`
- Tag: `expense-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/expenses/999999999`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoExpenseResponseDto`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: No valid expenseId because create is blocked by missing lookup seed data.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/expenses/999999999' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoExpenseResponseDto",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Expense not found",
  "errorCode": "EXPENSE_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.9613303"
}
```

### updateExpense

- API Name: updateExpense
- Operation ID: `updateExpense`
- Tag: `expense-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/expenses/999999999`
- Auth Required: Yes
- Request Schema: `#/components/schemas/ExpenseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: No valid expenseId because create is blocked by missing lookup seed data.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "expenseCategoryId": 1,
  "expenseDate": "2026-06-03",
  "amount": 10,
  "paymentMethodId": 1,
  "notes": "API documentation test expense"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/expenses/999999999' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"expenseCategoryId":1,"expenseDate":"2026-06-03","amount":10,"paymentMethodId":1,"notes":"API documentation test expense"}'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Expense not found",
  "errorCode": "EXPENSE_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.3483347"
}
```

### getItems

- API Name: getItems
- Operation ID: `getItems`
- Tag: `item-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/items?page=0&size=5&search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoItemListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  },
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/items?page=0&size=5&search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Items retrieved successfully",
  "data": {
    "content": [
      {
        "id": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "itemCode": "AIT20260603113236057",
        "sku": "SKU20260603113236057",
        "categoryName": "API Test Category 20260603113236057 Updated",
        "brandName": "API Test Brand 20260603113236057 Updated",
        "salePrice": 75,
        "availableQty": 22,
        "status": true
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.6731284"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createItem

- API Name: createItem
- Operation ID: `createItem`
- Tag: `item-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/items`
- Auth Required: Yes
- Request Schema: `#/components/schemas/ItemRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "itemName": "API Test Item 20260603113236057",
  "itemCode": "AIT20260603113236057",
  "sku": "SKU20260603113236057",
  "barcode": "BAR20260603113236057",
  "hsnCode": "1001",
  "categoryId": 3,
  "subCategoryId": null,
  "brandId": 4,
  "baseUnitId": 2,
  "secondaryUnitId": null,
  "conversionRate": 1,
  "purchasePrice": 50,
  "purchasePriceWithTax": 55,
  "taxPercentage": 10,
  "salePrice": 75,
  "wholesalePrice": 70,
  "mrp": 80,
  "msp": 60,
  "discountPercentage": 0,
  "profitMargin": 20,
  "batchNo": "BATCH20260603113236057",
  "manufacturingDate": "2026-06-01",
  "expiryDate": "2027-06-01",
  "openingQuantity": 20,
  "minimumStock": 5,
  "warehouseId": 3,
  "description": "API documentation test item"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/items' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"itemName":"API Test Item 20260603113236057","itemCode":"AIT20260603113236057","sku":"SKU20260603113236057","barcode":"BAR20260603113236057","hsnCode":"1001","categoryId":3,"subCategoryId":null,"brandId":4,"baseUnitId":2,"secondaryUnitId":null,"conversionRate":1,"purchasePrice":50,"purchasePriceWithTax":55,"taxPercentage":10,"salePrice":75,"wholesalePrice":70,"mrp":80,"msp":60,"discountPercentage":0,"profitMargin":20,"batchNo":"BATCH20260603113236057","manufacturingDate":"2026-06-01","expiryDate":"2027-06-01","openingQuantity":20,"minimumStock":5,"warehouseId":3,"description":"API documentation test item"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Item created successfully",
  "timestamp": "2026-06-03T17:02:37.5375696"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteItem

- API Name: deleteItem
- Operation ID: `deleteItem`
- Tag: `item-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/items/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/items/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getItemById

- API Name: getItemById
- Operation ID: `getItemById`
- Tag: `item-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/items/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoItemDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/items/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Item retrieved successfully",
  "data": {
    "id": 1,
    "itemName": "API Test Item 20260603113236057 Updated",
    "itemCode": "AIT20260603113236057",
    "sku": "SKU20260603113236057",
    "barcode": "BAR20260603113236057",
    "hsnCode": "1001",
    "categoryId": 3,
    "categoryName": "API Test Category 20260603113236057 Updated",
    "subCategoryId": null,
    "subCategoryName": null,
    "brandId": 4,
    "brandName": "API Test Brand 20260603113236057 Updated",
    "baseUnitId": 2,
    "baseUnitName": "API Test Unit 20260603113236057 Upd",
    "secondaryUnitId": null,
    "secondaryUnitName": null,
    "conversionRate": 1,
    "purchasePrice": 50,
    "purchasePriceWithTax": 55,
    "taxPercentage": 10,
    "salePrice": 75,
    "wholesalePrice": 70,
    "mrp": 80,
    "msp": 60,
    "discountPercentage": 0,
    "profitMargin": 20,
    "batchNo": "PURB20260603113236057",
    "manufacturingDate": "2026-06-01",
    "expiryDate": "2027-06-01",
    "availableQty": 19,
    "reservedQty": 0,
    "minimumStock": 5,
    "warehouseId": 3,
    "warehouseName": "API Test Warehouse A 20260603113236057 Updated",
    "description": "Updated API documentation test item",
    "status": true
  },
  "timestamp": "2026-06-03T17:02:38.6948997"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateItem

- API Name: updateItem
- Operation ID: `updateItem`
- Tag: `item-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/items/1`
- Auth Required: Yes
- Request Schema: `#/components/schemas/ItemRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "itemName": "API Test Item 20260603113236057 Updated",
  "itemCode": "AIT20260603113236057",
  "sku": "SKU20260603113236057",
  "barcode": "BAR20260603113236057",
  "hsnCode": "1001",
  "categoryId": 3,
  "subCategoryId": null,
  "brandId": 4,
  "baseUnitId": 2,
  "secondaryUnitId": null,
  "conversionRate": 1,
  "purchasePrice": 50,
  "purchasePriceWithTax": 55,
  "taxPercentage": 10,
  "salePrice": 75,
  "wholesalePrice": 70,
  "mrp": 80,
  "msp": 60,
  "discountPercentage": 0,
  "profitMargin": 20,
  "batchNo": "BATCH20260603113236057",
  "manufacturingDate": "2026-06-01",
  "expiryDate": "2027-06-01",
  "openingQuantity": 20,
  "minimumStock": 5,
  "warehouseId": 3,
  "description": "Updated API documentation test item"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/items/1' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"itemName":"API Test Item 20260603113236057 Updated","itemCode":"AIT20260603113236057","sku":"SKU20260603113236057","barcode":"BAR20260603113236057","hsnCode":"1001","categoryId":3,"subCategoryId":null,"brandId":4,"baseUnitId":2,"secondaryUnitId":null,"conversionRate":1,"purchasePrice":50,"purchasePriceWithTax":55,"taxPercentage":10,"salePrice":75,"wholesalePrice":70,"mrp":80,"msp":60,"discountPercentage":0,"profitMargin":20,"batchNo":"BATCH20260603113236057","manufacturingDate":"2026-06-01","expiryDate":"2027-06-01","openingQuantity":20,"minimumStock":5,"warehouseId":3,"description":"Updated API documentation test item"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Item updated successfully",
  "timestamp": "2026-06-03T17:02:37.6415276"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getItemStock

- API Name: getItemStock
- Operation ID: `getItemStock`
- Tag: `item-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/items/1/stock`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoItemStockResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/items/1/stock' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Item stock retrieved successfully",
  "data": {
    "itemId": 1,
    "itemName": "API Test Item 20260603113236057 Updated",
    "availableQty": 22,
    "reservedQty": 0,
    "warehouse": "API Test Warehouse A 20260603113236057 Updated"
  },
  "timestamp": "2026-06-03T17:02:38.7126818"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getOrganizations

- API Name: getOrganizations
- Operation ID: `getOrganizations`
- Tag: `organization-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/organizations?search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListOrganizationResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/organizations?search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Organizations retrieved successfully",
  "data": [
    {
      "id": 2,
      "name": "API Test Organization 20260603113021506",
      "description": "Created by API documentation test",
      "logoUrl": "",
      "address": "API Test Address",
      "status": true,
      "createdAt": "2026-06-03T17:00:21.811754",
      "updatedAt": "2026-06-03T17:00:21.811754"
    },
    {
      "id": 3,
      "name": "API Test Organization 20260603113236057 Updated",
      "description": "Updated by API documentation test",
      "logoUrl": "",
      "address": "API Test Address",
      "status": true,
      "createdAt": "2026-06-03T17:02:36.60758",
      "updatedAt": "2026-06-03T17:02:36.67353"
    }
  ],
  "timestamp": "2026-06-03T17:02:38.4154563"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createOrganization

- API Name: createOrganization
- Operation ID: `createOrganization`
- Tag: `organization-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/organizations`
- Auth Required: No
- Request Schema: `#/components/schemas/OrganizationRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200
- Notes/Fixes: Public in SecurityConfig; OpenAPI still inherits global Bearer security.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Organization 20260603113236057",
  "description": "Created by API documentation test",
  "logoUrl": "",
  "address": "API Test Address",
  "status": true
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/organizations' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"name":"API Test Organization 20260603113236057","description":"Created by API documentation test","logoUrl":"","address":"API Test Address","status":true}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Organization created successfully",
  "timestamp": "2026-06-03T17:02:36.6140943"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Validation failed",
  "errorCode": "VALIDATION_FAILED",
  "data": {
    "field": "reason"
  },
  "timestamp": "<timestamp>"
}
```

### deleteOrganization

- API Name: deleteOrganization
- Operation ID: `deleteOrganization`
- Tag: `organization-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/organizations/3`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/organizations/3' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getOrganizationById

- API Name: getOrganizationById
- Operation ID: `getOrganizationById`
- Tag: `organization-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/organizations/3`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoOrganizationResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/organizations/3' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Organization retrieved successfully",
  "data": {
    "id": 3,
    "name": "API Test Organization 20260603113236057 Updated",
    "description": "Updated by API documentation test",
    "logoUrl": "",
    "address": "API Test Address",
    "status": true,
    "createdAt": "2026-06-03T17:02:36.60758",
    "updatedAt": "2026-06-03T17:02:36.67353"
  },
  "timestamp": "2026-06-03T17:02:38.4293843"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateOrganization

- API Name: updateOrganization
- Operation ID: `updateOrganization`
- Tag: `organization-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/organizations/3`
- Auth Required: Yes
- Request Schema: `#/components/schemas/OrganizationRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Organization 20260603113236057 Updated",
  "description": "Updated by API documentation test",
  "logoUrl": "",
  "address": "API Test Address",
  "status": true
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/organizations/3' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Organization 20260603113236057 Updated","description":"Updated by API documentation test","logoUrl":"","address":"API Test Address","status":true}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Organization updated successfully",
  "timestamp": "2026-06-03T17:02:36.6975453"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getPaymentIns

- API Name: getPaymentIns
- Operation ID: `getPaymentIns`
- Tag: `payment-in-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/payment-in?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoPaymentListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/payment-in?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Payments retrieved successfully",
  "data": {
    "content": [],
    "page": 0,
    "size": 5,
    "totalElements": 0,
    "totalPages": 0,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.9709702"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createPaymentIn

- API Name: createPaymentIn
- Operation ID: `createPaymentIn`
- Tag: `payment-in-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/payment-in`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PaymentInRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "customerId": 5,
  "paymentDate": "2026-06-03",
  "paymentMethodId": 1,
  "referenceNo": "API-PIN-20260603113236057",
  "amount": 10,
  "notes": "API documentation test payment in",
  "saleIds": [
    1
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/payment-in' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"customerId":5,"paymentDate":"2026-06-03","paymentMethodId":1,"referenceNo":"API-PIN-20260603113236057","amount":10,"notes":"API documentation test payment in","saleIds":[1]}'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Payment method not found",
  "errorCode": "PAYMENT_METHOD_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.3675212"
}
```

### getPaymentInById

- API Name: getPaymentInById
- Operation ID: `getPaymentInById`
- Tag: `payment-in-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/payment-in/999999999`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPaymentDetailResponseDto`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: No valid paymentInId because create is blocked by missing payment method seed data.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/payment-in/999999999' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoPaymentDetailResponseDto",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Payment not found",
  "errorCode": "PAYMENT_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.9810844"
}
```

### getPaymentOuts

- API Name: getPaymentOuts
- Operation ID: `getPaymentOuts`
- Tag: `payment-out-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/payment-out?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoPaymentListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/payment-out?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Payments retrieved successfully",
  "data": {
    "content": [],
    "page": 0,
    "size": 5,
    "totalElements": 0,
    "totalPages": 0,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.9914062"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createPaymentOut

- API Name: createPaymentOut
- Operation ID: `createPaymentOut`
- Tag: `payment-out-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/payment-out`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PaymentOutRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "supplierId": 6,
  "paymentDate": "2026-06-03",
  "paymentMethodId": 1,
  "referenceNo": "API-POUT-20260603113236057",
  "amount": 10,
  "notes": "API documentation test payment out",
  "purchaseIds": [
    1
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/payment-out' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"supplierId":6,"paymentDate":"2026-06-03","paymentMethodId":1,"referenceNo":"API-POUT-20260603113236057","amount":10,"notes":"API documentation test payment out","purchaseIds":[1]}'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Payment method not found",
  "errorCode": "PAYMENT_METHOD_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.3831389"
}
```

### getPaymentOutById

- API Name: getPaymentOutById
- Operation ID: `getPaymentOutById`
- Tag: `payment-out-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/payment-out/999999999`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPaymentDetailResponseDto`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: No valid paymentOutId because create is blocked by missing payment method seed data.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/payment-out/999999999' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoPaymentDetailResponseDto",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Payment not found",
  "errorCode": "PAYMENT_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:39.0009256"
}
```

### createBill

- API Name: createBill
- Operation ID: `createBill`
- Tag: `pos-billing-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/pos/billing`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PosBillingRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: EXPECTED FAILURE: HTTP 404
- Notes/Fixes: Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "customerId": 5,
  "warehouseId": 3,
  "paymentMethodId": 1,
  "items": [
    {
      "itemId": 1,
      "quantity": 1
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/pos/billing' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"customerId":5,"warehouseId":3,"paymentMethodId":1,"items":[{"itemId":1,"quantity":1}]}'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "No successful response observed in this run"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Payment method not found",
  "errorCode": "PAYMENT_METHOD_NOT_FOUND",
  "timestamp": "2026-06-03T17:02:38.3999356"
}
```

### getPurchaseReturns

- API Name: getPurchaseReturns
- Operation ID: `getPurchaseReturns`
- Tag: `purchase-return-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/purchase-returns?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoReturnListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/purchase-returns?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase returns retrieved successfully",
  "data": {
    "content": [
      {
        "returnId": 1,
        "returnNo": "PR-000001",
        "partyName": "API Test Supplier Co 20260603113236057 Updated",
        "returnDate": "2026-06-03",
        "grandTotal": 50
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.8165336"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createPurchaseReturn

- API Name: createPurchaseReturn
- Operation ID: `createPurchaseReturn`
- Tag: `purchase-return-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/purchase-returns`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PurchaseReturnRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "purchaseId": 1,
  "supplierId": 6,
  "returnDate": "2026-06-03",
  "reason": "API documentation test purchase return",
  "items": [
    {
      "itemId": 1,
      "batchId": 2,
      "quantity": 1,
      "rate": 50
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/purchase-returns' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"purchaseId":1,"supplierId":6,"returnDate":"2026-06-03","reason":"API documentation test purchase return","items":[{"itemId":1,"batchId":2,"quantity":1,"rate":50}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase return created successfully",
  "timestamp": "2026-06-03T17:02:38.1137177"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getPurchaseReturnById

- API Name: getPurchaseReturnById
- Operation ID: `getPurchaseReturnById`
- Tag: `purchase-return-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/purchase-returns/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoReturnDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/purchase-returns/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase return retrieved successfully",
  "data": {
    "returnId": 1,
    "returnNo": "PR-000001",
    "returnDate": "2026-06-03",
    "party": {
      "id": 6,
      "name": "API Test Supplier Co 20260603113236057 Updated"
    },
    "reason": "API documentation test purchase return",
    "subTotal": 50,
    "discountAmount": 0,
    "taxAmount": 0,
    "grandTotal": 50,
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 2,
        "batchNo": "PURB20260603113236057",
        "quantity": 1,
        "rate": 50,
        "amount": 50
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.835206"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getPurchases

- API Name: getPurchases
- Operation ID: `getPurchases`
- Tag: `purchase-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/purchases?page=0&size=5&search=API&fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoPurchaseListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  },
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  },
  {
    "name": "fromDate",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/purchases?page=0&size=5&search=API&fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchases retrieved successfully",
  "data": {
    "content": [
      {
        "purchaseId": 1,
        "purchaseNo": "PUR-000001",
        "supplierName": "API Test Supplier Co 20260603113236057 Updated",
        "purchaseDate": "2026-06-03",
        "grandTotal": 150,
        "paidAmount": 0,
        "dueAmount": 150
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.7308006"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createPurchase

- API Name: createPurchase
- Operation ID: `createPurchase`
- Tag: `purchase-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/purchases`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PurchaseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "supplierId": 6,
  "purchaseDate": "2026-06-03",
  "referenceNo": "API-PUR-20260603113236057",
  "warehouseId": 3,
  "carrierId": null,
  "stateId": 1,
  "notes": "API documentation test purchase",
  "items": [
    {
      "itemId": 1,
      "batchNo": "PURB20260603113236057",
      "manufacturingDate": "2026-06-01",
      "expiryDate": "2027-06-01",
      "quantity": 3,
      "unitPrice": 50,
      "discountPercent": 0,
      "taxPercent": 0
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/purchases' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"supplierId":6,"purchaseDate":"2026-06-03","referenceNo":"API-PUR-20260603113236057","warehouseId":3,"carrierId":null,"stateId":1,"notes":"API documentation test purchase","items":[{"itemId":1,"batchNo":"PURB20260603113236057","manufacturingDate":"2026-06-01","expiryDate":"2027-06-01","quantity":3,"unitPrice":50,"discountPercent":0,"taxPercent":0}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase created successfully",
  "timestamp": "2026-06-03T17:02:37.71772"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getPurchaseById

- API Name: getPurchaseById
- Operation ID: `getPurchaseById`
- Tag: `purchase-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/purchases/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPurchaseDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/purchases/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase retrieved successfully",
  "data": {
    "purchaseId": 1,
    "purchaseNo": "PUR-000001",
    "purchaseDate": "2026-06-03",
    "referenceNo": "API-PUR-UPD-20260603113236057",
    "supplier": {
      "id": 6,
      "name": "API Test Supplier Co 20260603113236057 Updated"
    },
    "warehouse": {
      "id": 3,
      "name": "API Test Warehouse A 20260603113236057 Updated"
    },
    "subTotal": 150,
    "discountAmount": 0,
    "taxAmount": 0,
    "grandTotal": 150,
    "paidAmount": 0,
    "dueAmount": 150,
    "status": "ACTIVE",
    "notes": "Updated API documentation test purchase",
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 2,
        "batchNo": "PURB20260603113236057",
        "qty": 3,
        "unitPrice": 50,
        "discountAmount": 0,
        "taxAmount": 0,
        "totalAmount": 150
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:37.832824"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updatePurchase

- API Name: updatePurchase
- Operation ID: `updatePurchase`
- Tag: `purchase-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/purchases/1`
- Auth Required: Yes
- Request Schema: `#/components/schemas/PurchaseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "supplierId": 6,
  "purchaseDate": "2026-06-03",
  "referenceNo": "API-PUR-UPD-20260603113236057",
  "warehouseId": 3,
  "carrierId": null,
  "stateId": 1,
  "notes": "Updated API documentation test purchase",
  "items": [
    {
      "itemId": 1,
      "batchNo": "PURB20260603113236057",
      "manufacturingDate": "2026-06-01",
      "expiryDate": "2027-06-01",
      "quantity": 3,
      "unitPrice": 50,
      "discountPercent": 0,
      "taxPercent": 0
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/purchases/1' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"supplierId":6,"purchaseDate":"2026-06-03","referenceNo":"API-PUR-UPD-20260603113236057","warehouseId":3,"carrierId":null,"stateId":1,"notes":"Updated API documentation test purchase","items":[{"itemId":1,"batchNo":"PURB20260603113236057","manufacturingDate":"2026-06-01","expiryDate":"2027-06-01","quantity":3,"unitPrice":50,"discountPercent":0,"taxPercent":0}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Purchase updated successfully",
  "timestamp": "2026-06-03T17:02:37.8129071"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### cancelPurchase

- API Name: cancelPurchase
- Operation ID: `cancelPurchase`
- Tag: `purchase-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/purchases/1/cancel`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: Cancel reverses stock and changes purchase status; not executed per safe-test instruction.
- Notes/Fixes: Cancel reverses stock and changes purchase status; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/purchases/1/cancel' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getCustomerLedger

- API Name: getCustomerLedger
- Operation ID: `getCustomerLedger`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/customer-ledger/5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoLedgerResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "customerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/customer-ledger/5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "openingBalance": 0,
    "transactions": [
      {
        "date": "2026-06-03",
        "type": "SALE",
        "referenceNo": "INV-000001",
        "debit": 75,
        "credit": 0,
        "balance": 75
      },
      {
        "date": "2026-06-03",
        "type": "SALES_RETURN",
        "referenceNo": "SR-000001",
        "debit": 0,
        "credit": 75,
        "balance": 0
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:39.0737822"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getDayBook

- API Name: getDayBook
- Operation ID: `getDayBook`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/day-book?date=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListDayBookEntryResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "date",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/day-book?date=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": [
    {
      "date": "2026-06-03",
      "type": "SALE",
      "referenceNo": "INV-000001",
      "debit": 75,
      "credit": 0
    },
    {
      "date": "2026-06-03",
      "type": "PURCHASE",
      "referenceNo": "PUR-000001",
      "debit": 0,
      "credit": 150
    }
  ],
  "timestamp": "2026-06-03T17:02:39.109727"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getGstReport

- API Name: getGstReport
- Operation ID: `getGstReport`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/gst?fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoGstReportResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "fromDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/gst?fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "taxableAmount": 75,
    "cgst": 0,
    "sgst": 0,
    "igst": 0,
    "totalTax": 0
  },
  "timestamp": "2026-06-03T17:02:39.1240584"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getInventoryValuation

- API Name: getInventoryValuation
- Operation ID: `getInventoryValuation`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/inventory-valuation`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoInventoryValuationResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/inventory-valuation' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "totalStockValue": 1100,
    "records": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "warehouseId": 3,
        "warehouseName": "API Test Warehouse A 20260603113236057 Updated",
        "batchId": 1,
        "batchNo": "BATCH20260603113236057",
        "availableQty": 19,
        "reorderLevel": 5,
        "stockValue": 950
      },
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "warehouseId": 3,
        "warehouseName": "API Test Warehouse A 20260603113236057 Updated",
        "batchId": 2,
        "batchNo": "PURB20260603113236057",
        "availableQty": 2,
        "reorderLevel": 0,
        "stockValue": 100
      },
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "warehouseId": 4,
        "warehouseName": "API Test Warehouse B 20260603113236057",
        "batchId": 1,
        "batchNo": "BATCH20260603113236057",
        "availableQty": 1,
        "reorderLevel": 0,
        "stockValue": 50
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:39.1429186"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getLowStockReport

- API Name: getLowStockReport
- Operation ID: `getLowStockReport`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/low-stock`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListStockReportResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/low-stock' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": [],
  "timestamp": "2026-06-03T17:02:39.1617168"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getProfitLoss

- API Name: getProfitLoss
- Operation ID: `getProfitLoss`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/profit-loss?fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoProfitLossReportResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "fromDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/profit-loss?fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "totalSales": 75,
    "totalPurchase": 150,
    "totalExpense": 0,
    "grossProfit": -75,
    "netProfit": -75
  },
  "timestamp": "2026-06-03T17:02:39.1779893"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getPurchaseReport

- API Name: getPurchaseReport
- Operation ID: `getPurchaseReport`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/purchases?fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoSummaryReportResponseDtoObject`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "fromDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/purchases?fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "totalSales": null,
    "totalPurchase": 150,
    "totalExpense": null,
    "invoiceCount": 0,
    "purchaseCount": 1,
    "records": [
      {
        "purchaseId": 1,
        "purchaseNo": "PUR-000001",
        "supplierName": "API Test Supplier Co 20260603113236057 Updated",
        "purchaseDate": "2026-06-03",
        "grandTotal": 150,
        "paidAmount": 0,
        "dueAmount": 150
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:39.1922648"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSalesReport

- API Name: getSalesReport
- Operation ID: `getSalesReport`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/sales?fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoSummaryReportResponseDtoObject`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "fromDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/sales?fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "totalSales": 75,
    "totalPurchase": null,
    "totalExpense": null,
    "invoiceCount": 1,
    "purchaseCount": 0,
    "records": [
      {
        "saleId": 1,
        "invoiceNo": "INV-000001",
        "customerName": "API Test Customer Co 20260603113236057 Updated",
        "invoiceDate": "2026-06-03",
        "grandTotal": 75,
        "paidAmount": 0,
        "dueAmount": 75
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:39.2061984"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getStockReport

- API Name: getStockReport
- Operation ID: `getStockReport`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/stocks`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListStockReportResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/stocks' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": [
    {
      "itemId": 1,
      "itemName": "API Test Item 20260603113236057 Updated",
      "warehouseId": 3,
      "warehouseName": "API Test Warehouse A 20260603113236057 Updated",
      "batchId": 1,
      "batchNo": "BATCH20260603113236057",
      "availableQty": 19,
      "reorderLevel": 5,
      "stockValue": 950
    },
    {
      "itemId": 1,
      "itemName": "API Test Item 20260603113236057 Updated",
      "warehouseId": 3,
      "warehouseName": "API Test Warehouse A 20260603113236057 Updated",
      "batchId": 2,
      "batchNo": "PURB20260603113236057",
      "availableQty": 2,
      "reorderLevel": 0,
      "stockValue": 100
    },
    {
      "itemId": 1,
      "itemName": "API Test Item 20260603113236057 Updated",
      "warehouseId": 4,
      "warehouseName": "API Test Warehouse B 20260603113236057",
      "batchId": 1,
      "batchNo": "BATCH20260603113236057",
      "availableQty": 1,
      "reorderLevel": 0,
      "stockValue": 50
    }
  ],
  "timestamp": "2026-06-03T17:02:39.2252458"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSupplierLedger_1

- API Name: getSupplierLedger_1
- Operation ID: `getSupplierLedger_1`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/supplier-ledger/6`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoLedgerResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "supplierId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/supplier-ledger/6' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": {
    "openingBalance": 0,
    "transactions": [
      {
        "date": "2026-06-03",
        "type": "PURCHASE",
        "referenceNo": "PUR-000001",
        "debit": 0,
        "credit": 150,
        "balance": 150
      },
      {
        "date": "2026-06-03",
        "type": "PURCHASE_RETURN",
        "referenceNo": "PR-000001",
        "debit": 50,
        "credit": 0,
        "balance": 100
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:39.0900292"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getTopSellingItems

- API Name: getTopSellingItems
- Operation ID: `getTopSellingItems`
- Tag: `report-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/reports/top-selling-items`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListTopSellingItemResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/reports/top-selling-items' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Report retrieved successfully",
  "data": [
    {
      "itemId": 1,
      "itemName": "API Test Item 20260603113236057 Updated",
      "quantity": 1,
      "totalAmount": 75
    }
  ],
  "timestamp": "2026-06-03T17:02:39.2402946"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSales

- API Name: getSales
- Operation ID: `getSales`
- Tag: `sales-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/sales?page=0&size=5&search=API&fromDate=2026-06-01&toDate=2026-06-03`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoSalesListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  },
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  },
  {
    "name": "fromDate",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string",
      "format": "date"
    }
  },
  {
    "name": "toDate",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string",
      "format": "date"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/sales?page=0&size=5&search=API&fromDate=2026-06-01&toDate=2026-06-03' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales invoices retrieved successfully",
  "data": {
    "content": [
      {
        "saleId": 1,
        "invoiceNo": "INV-000001",
        "customerName": "API Test Customer Co 20260603113236057 Updated",
        "invoiceDate": "2026-06-03",
        "grandTotal": 75,
        "paidAmount": 0,
        "dueAmount": 75
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.74735"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createSale

- API Name: createSale
- Operation ID: `createSale`
- Tag: `sales-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/sales`
- Auth Required: Yes
- Request Schema: `#/components/schemas/SalesRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "customerId": 5,
  "invoiceDate": "2026-06-03",
  "warehouseId": 3,
  "stateId": 1,
  "salesPersonId": 1,
  "notes": "API documentation test sale",
  "items": [
    {
      "itemId": 1,
      "batchId": 2,
      "quantity": 1,
      "unitPrice": 75,
      "discountPercent": 0,
      "taxPercent": 0
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/sales' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"customerId":5,"invoiceDate":"2026-06-03","warehouseId":3,"stateId":1,"salesPersonId":1,"notes":"API documentation test sale","items":[{"itemId":1,"batchId":2,"quantity":1,"unitPrice":75,"discountPercent":0,"taxPercent":0}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales invoice created successfully",
  "timestamp": "2026-06-03T17:02:37.9045369"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSalesReturns

- API Name: getSalesReturns
- Operation ID: `getSalesReturns`
- Tag: `sales-return-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/sales-returns?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoReturnListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/sales-returns?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales returns retrieved successfully",
  "data": {
    "content": [
      {
        "returnId": 1,
        "returnNo": "SR-000001",
        "partyName": "API Test Customer Co 20260603113236057 Updated",
        "returnDate": "2026-06-03",
        "grandTotal": 75
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.8529055"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createSalesReturn

- API Name: createSalesReturn
- Operation ID: `createSalesReturn`
- Tag: `sales-return-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/sales-returns`
- Auth Required: Yes
- Request Schema: `#/components/schemas/SalesReturnRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "saleId": 1,
  "customerId": 5,
  "returnDate": "2026-06-03",
  "reason": "API documentation test sales return",
  "items": [
    {
      "itemId": 1,
      "batchId": 2,
      "quantity": 1,
      "rate": 75
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/sales-returns' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"saleId":1,"customerId":5,"returnDate":"2026-06-03","reason":"API documentation test sales return","items":[{"itemId":1,"batchId":2,"quantity":1,"rate":75}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales return created successfully",
  "timestamp": "2026-06-03T17:02:38.0315935"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSalesReturnById

- API Name: getSalesReturnById
- Operation ID: `getSalesReturnById`
- Tag: `sales-return-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/sales-returns/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoReturnDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/sales-returns/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales return retrieved successfully",
  "data": {
    "returnId": 1,
    "returnNo": "SR-000001",
    "returnDate": "2026-06-03",
    "party": {
      "id": 5,
      "name": "API Test Customer Co 20260603113236057 Updated"
    },
    "reason": "API documentation test sales return",
    "subTotal": 75,
    "discountAmount": 0,
    "taxAmount": 0,
    "grandTotal": 75,
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 2,
        "batchNo": "PURB20260603113236057",
        "quantity": 1,
        "rate": 75,
        "amount": 75
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.8733897"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSaleById

- API Name: getSaleById
- Operation ID: `getSaleById`
- Tag: `sales-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/sales/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoSalesDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/sales/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales invoice retrieved successfully",
  "data": {
    "saleId": 1,
    "invoiceNo": "INV-000001",
    "invoiceDate": "2026-06-03",
    "customer": {
      "id": 5,
      "name": "API Test Customer Co 20260603113236057 Updated"
    },
    "warehouse": {
      "id": 3,
      "name": "API Test Warehouse A 20260603113236057 Updated"
    },
    "subTotal": 75,
    "discountAmount": 0,
    "taxAmount": 0,
    "grandTotal": 75,
    "paidAmount": 0,
    "dueAmount": 75,
    "status": "ACTIVE",
    "notes": "Updated API documentation test sale",
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 2,
        "batchNo": "PURB20260603113236057",
        "qty": 1,
        "unitPrice": 75,
        "discountAmount": 0,
        "taxAmount": 0,
        "totalAmount": 75
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.7806029"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateSale

- API Name: updateSale
- Operation ID: `updateSale`
- Tag: `sales-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/sales/1`
- Auth Required: Yes
- Request Schema: `#/components/schemas/SalesRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "customerId": 5,
  "invoiceDate": "2026-06-03",
  "warehouseId": 3,
  "stateId": 1,
  "salesPersonId": 1,
  "notes": "Updated API documentation test sale",
  "items": [
    {
      "itemId": 1,
      "batchId": 2,
      "quantity": 1,
      "unitPrice": 75,
      "discountPercent": 0,
      "taxPercent": 0
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/sales/1' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"customerId":5,"invoiceDate":"2026-06-03","warehouseId":3,"stateId":1,"salesPersonId":1,"notes":"Updated API documentation test sale","items":[{"itemId":1,"batchId":2,"quantity":1,"unitPrice":75,"discountPercent":0,"taxPercent":0}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales invoice updated successfully",
  "timestamp": "2026-06-03T17:02:37.9770848"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### cancelSale

- API Name: cancelSale
- Operation ID: `cancelSale`
- Tag: `sales-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/sales/1/cancel`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: Cancel reverses stock and changes sale status; not executed per safe-test instruction.
- Notes/Fixes: Cancel reverses stock and changes sale status; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/sales/1/cancel' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getInvoice

- API Name: getInvoice
- Operation ID: `getInvoice`
- Tag: `sales-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/sales/1/invoice`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoSalesInvoiceResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/sales/1/invoice' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Sales invoice retrieved successfully",
  "data": {
    "invoiceNo": "INV-000001",
    "customerName": "API Test Customer Co 20260603113236057 Updated",
    "grandTotal": 75
  },
  "timestamp": "2026-06-03T17:02:38.8022551"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getAdjustments

- API Name: getAdjustments
- Operation ID: `getAdjustments`
- Tag: `stock-adjustment-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/stocks/adjustments?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoStockAdjustmentResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/stocks/adjustments?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock adjustments retrieved successfully",
  "data": {
    "content": [
      {
        "adjustmentId": 1,
        "adjustmentNo": "ADJ-000001",
        "warehouse": {
          "id": 3,
          "name": "API Test Warehouse A 20260603113236057 Updated"
        },
        "adjustmentDate": "2026-06-03",
        "reason": "API documentation test no-op stock adjustment",
        "items": [
          {
            "itemId": 1,
            "itemName": "API Test Item 20260603113236057 Updated",
            "batchId": 1,
            "batchNo": "BATCH20260603113236057",
            "currentQty": 22,
            "actualQty": 22,
            "differenceQty": 0
          }
        ]
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.8882424"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createAdjustment

- API Name: createAdjustment
- Operation ID: `createAdjustment`
- Tag: `stock-adjustment-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/stocks/adjustments`
- Auth Required: Yes
- Request Schema: `#/components/schemas/StockAdjustmentRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200
- Notes/Fixes: No-op adjustment: currentQty equals actualQty to avoid changing stock quantity.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "warehouseId": 3,
  "adjustmentDate": "2026-06-03",
  "reason": "API documentation test no-op stock adjustment",
  "items": [
    {
      "itemId": 1,
      "currentQty": 22,
      "actualQty": 22
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/stocks/adjustments' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"warehouseId":3,"adjustmentDate":"2026-06-03","reason":"API documentation test no-op stock adjustment","items":[{"itemId":1,"currentQty":22,"actualQty":22}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock adjustment completed",
  "timestamp": "2026-06-03T17:02:38.2005299"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getAdjustmentById

- API Name: getAdjustmentById
- Operation ID: `getAdjustmentById`
- Tag: `stock-adjustment-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/stocks/adjustments/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoStockAdjustmentResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/stocks/adjustments/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock adjustment retrieved successfully",
  "data": {
    "adjustmentId": 1,
    "adjustmentNo": "ADJ-000001",
    "warehouse": {
      "id": 3,
      "name": "API Test Warehouse A 20260603113236057 Updated"
    },
    "adjustmentDate": "2026-06-03",
    "reason": "API documentation test no-op stock adjustment",
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 1,
        "batchNo": "BATCH20260603113236057",
        "currentQty": 22,
        "actualQty": 22,
        "differenceQty": 0
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.9042078"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getTransfers

- API Name: getTransfers
- Operation ID: `getTransfers`
- Tag: `stock-transfer-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/stocks/transfers?page=0&size=5`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoStockTransferResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/stocks/transfers?page=0&size=5' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock transfers retrieved successfully",
  "data": {
    "content": [
      {
        "transferId": 1,
        "transferNo": "TRF-000001",
        "fromWarehouse": {
          "id": 3,
          "name": "API Test Warehouse A 20260603113236057 Updated"
        },
        "toWarehouse": {
          "id": 4,
          "name": "API Test Warehouse B 20260603113236057"
        },
        "transferDate": "2026-06-03",
        "notes": "API documentation test stock transfer",
        "items": [
          {
            "itemId": 1,
            "itemName": "API Test Item 20260603113236057 Updated",
            "batchId": 1,
            "batchNo": "BATCH20260603113236057",
            "quantity": 1
          }
        ]
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.9209367"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### transferStock

- API Name: transferStock
- Operation ID: `transferStock`
- Tag: `stock-transfer-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/stocks/transfers`
- Auth Required: Yes
- Request Schema: `#/components/schemas/StockTransferRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200
- Notes/Fixes: Transferred quantity 1 between API-test warehouses.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "fromWarehouseId": 3,
  "toWarehouseId": 4,
  "transferDate": "2026-06-03",
  "notes": "API documentation test stock transfer",
  "items": [
    {
      "itemId": 1,
      "quantity": 1
    }
  ]
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/stocks/transfers' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"fromWarehouseId":3,"toWarehouseId":4,"transferDate":"2026-06-03","notes":"API documentation test stock transfer","items":[{"itemId":1,"quantity":1}]}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock transferred successfully",
  "timestamp": "2026-06-03T17:02:38.2873953"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getTransferById

- API Name: getTransferById
- Operation ID: `getTransferById`
- Tag: `stock-transfer-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/stocks/transfers/1`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoStockTransferResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/stocks/transfers/1' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Stock transfer retrieved successfully",
  "data": {
    "transferId": 1,
    "transferNo": "TRF-000001",
    "fromWarehouse": {
      "id": 3,
      "name": "API Test Warehouse A 20260603113236057 Updated"
    },
    "toWarehouse": {
      "id": 4,
      "name": "API Test Warehouse B 20260603113236057"
    },
    "transferDate": "2026-06-03",
    "notes": "API documentation test stock transfer",
    "items": [
      {
        "itemId": 1,
        "itemName": "API Test Item 20260603113236057 Updated",
        "batchId": 1,
        "batchNo": "BATCH20260603113236057",
        "quantity": 1
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.93794"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSuppliers

- API Name: getSuppliers
- Operation ID: `getSuppliers`
- Tag: `supplier-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/suppliers?page=0&size=5&search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoPageResponseDtoSupplierListResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "page",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 0,
      "minimum": 0
    }
  },
  {
    "name": "size",
    "in": "query",
    "required": false,
    "schema": {
      "type": "integer",
      "format": "int32",
      "default": 20,
      "exclusiveMinimum": 0
    }
  },
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/suppliers?page=0&size=5&search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Suppliers retrieved successfully",
  "data": {
    "content": [
      {
        "id": 6,
        "supplierCode": "SUP000006",
        "supplierName": "Api Supplier",
        "mobile": "8113236057",
        "balance": 100
      },
      {
        "id": 4,
        "supplierCode": "SUP000004",
        "supplierName": "Api Supplier",
        "mobile": "8113021506",
        "balance": 0
      }
    ],
    "page": 0,
    "size": 5,
    "totalElements": 2,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-03T17:02:38.6127216"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createSupplier

- API Name: createSupplier
- Operation ID: `createSupplier`
- Tag: `supplier-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/suppliers`
- Auth Required: Yes
- Request Schema: `#/components/schemas/SupplierRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "firstName": "Api",
  "lastName": "Supplier",
  "mobile": "8113236057",
  "email": "apitest.supplier.20260603113236057@example.com",
  "gstNumber": "",
  "creditLimit": 1000,
  "openingBalance": 0
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/suppliers' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"firstName":"Api","lastName":"Supplier","mobile":"8113236057","email":"apitest.supplier.20260603113236057@example.com","gstNumber":"","creditLimit":1000,"openingBalance":0}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Supplier created successfully",
  "timestamp": "2026-06-03T17:02:37.4145973"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteSupplier

- API Name: deleteSupplier
- Operation ID: `deleteSupplier`
- Tag: `supplier-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/suppliers/6`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/suppliers/6' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSupplierById

- API Name: getSupplierById
- Operation ID: `getSupplierById`
- Tag: `supplier-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/suppliers/6`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoSupplierDetailResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/suppliers/6' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Supplier retrieved successfully",
  "data": {
    "id": 6,
    "supplierCode": "SUP000006",
    "firstName": "Api",
    "lastName": "Supplier",
    "mobile": "8113236057",
    "email": "apitest.supplier.20260603113236057@example.com",
    "gstNumber": "",
    "creditLimit": 1000,
    "openingBalance": 0,
    "currentBalance": 100
  },
  "timestamp": "2026-06-03T17:02:38.6291176"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateSupplier

- API Name: updateSupplier
- Operation ID: `updateSupplier`
- Tag: `supplier-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/suppliers/6`
- Auth Required: Yes
- Request Schema: `#/components/schemas/SupplierRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "firstName": "Api",
  "lastName": "Supplier",
  "mobile": "8113236057",
  "email": "apitest.supplier.20260603113236057@example.com",
  "gstNumber": "",
  "creditLimit": 1000,
  "openingBalance": 0
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/suppliers/6' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"firstName":"Api","lastName":"Supplier","mobile":"8113236057","email":"apitest.supplier.20260603113236057@example.com","gstNumber":"","creditLimit":1000,"openingBalance":0}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Supplier updated successfully",
  "timestamp": "2026-06-03T17:02:37.4567739"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getSupplierLedger

- API Name: getSupplierLedger
- Operation ID: `getSupplierLedger`
- Tag: `supplier-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/suppliers/6/ledger`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoLedgerResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/suppliers/6/ledger' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Supplier ledger retrieved successfully",
  "data": {
    "openingBalance": 0,
    "transactions": [
      {
        "date": "2026-06-03",
        "type": "PURCHASE",
        "referenceNo": "PUR-000001",
        "debit": 0,
        "credit": 150,
        "balance": 150
      },
      {
        "date": "2026-06-03",
        "type": "PURCHASE_RETURN",
        "referenceNo": "PR-000001",
        "debit": 50,
        "credit": 0,
        "balance": 100
      }
    ]
  },
  "timestamp": "2026-06-03T17:02:38.6514883"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### getUnits

- API Name: getUnits
- Operation ID: `getUnits`
- Tag: `unit-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/units?search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListUnitResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/units?search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Units retrieved successfully",
  "data": [
    {
      "id": 1,
      "name": "API Test Unit 20260603113021506",
      "shortName": "AT1506",
      "status": true
    },
    {
      "id": 2,
      "name": "API Test Unit 20260603113236057 Upd",
      "shortName": "AU6057",
      "status": true
    }
  ],
  "timestamp": "2026-06-03T17:02:38.4749168"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createUnit

- API Name: createUnit
- Operation ID: `createUnit`
- Tag: `unit-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/units`
- Auth Required: Yes
- Request Schema: `#/components/schemas/UnitRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Unit 20260603113236057",
  "shortName": "AT6057"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/units' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Unit 20260603113236057","shortName":"AT6057"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Unit created successfully",
  "timestamp": "2026-06-03T17:02:37.0944884"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteUnit

- API Name: deleteUnit
- Operation ID: `deleteUnit`
- Tag: `unit-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/units/2`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/units/2' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateUnit

- API Name: updateUnit
- Operation ID: `updateUnit`
- Tag: `unit-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/units/2`
- Auth Required: Yes
- Request Schema: `#/components/schemas/UnitRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Unit 20260603113236057 Upd",
  "shortName": "AU6057"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/units/2' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Unit 20260603113236057 Upd","shortName":"AU6057"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Unit updated successfully",
  "timestamp": "2026-06-03T17:02:37.1418057"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createUser

- API Name: createUser
- Operation ID: `createUser`
- Tag: `user-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/users`
- Auth Required: No
- Request Schema: `#/components/schemas/CreateUserRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200
- Notes/Fixes: Public in SecurityConfig. Test user was created inactive with status=false.

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "firstName": "Api",
  "lastName": "User",
  "userName": "apitest_20260603113236057",
  "email": "apitest.user.20260603113236057@example.com",
  "mobileNo": "7113236057",
  "roleId": 1,
  "organizationId": 1,
  "password": "<redacted>",
  "status": false
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/users' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Api","lastName":"User","userName":"apitest_20260603113236057","email":"apitest.user.20260603113236057@example.com","mobileNo":"7113236057","roleId":1,"organizationId":1,"password":"<redacted>","status":false}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "User created successfully",
  "timestamp": "2026-06-03T17:02:36.8922967"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Validation failed",
  "errorCode": "VALIDATION_FAILED",
  "data": {
    "field": "reason"
  },
  "timestamp": "<timestamp>"
}
```

### getWarehouses

- API Name: getWarehouses
- Operation ID: `getWarehouses`
- Tag: `warehouse-controller`
- HTTP Method: `GET`
- URL: `http://localhost:8081/api/v1/warehouses?search=API`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoListWarehouseResponseDto`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[
  {
    "name": "search",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X GET 'http://localhost:8081/api/v1/warehouses?search=API' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Warehouses retrieved successfully",
  "data": [
    {
      "id": 1,
      "name": "API Test Warehouse A 20260603113021506",
      "warehouseCode": "ATW113021506",
      "description": "Source warehouse for API documentation test",
      "address": "API Test Address A",
      "status": true
    },
    {
      "id": 3,
      "name": "API Test Warehouse A 20260603113236057 Updated",
      "warehouseCode": "ATW113236057",
      "description": "Updated source warehouse for API documentation test",
      "address": "API Test Address A",
      "status": true
    },
    {
      "id": 2,
      "name": "API Test Warehouse B 20260603113021506",
      "warehouseCode": "ATW213021506",
      "description": "Destination warehouse for API documentation test",
      "address": "API Test Address B",
      "status": true
    }
  ],
  "timestamp": "2026-06-03T17:02:38.4921298"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### createWarehouse

- API Name: createWarehouse
- Operation ID: `createWarehouse`
- Tag: `warehouse-controller`
- HTTP Method: `POST`
- URL: `http://localhost:8081/api/v1/warehouses`
- Auth Required: Yes
- Request Schema: `#/components/schemas/WarehouseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Warehouse A 20260603113236057",
  "warehouseCode": "ATW113236057",
  "description": "Source warehouse for API documentation test",
  "address": "API Test Address A"
}
```

Curl-style Test Request:

```bash
curl -X POST 'http://localhost:8081/api/v1/warehouses' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Warehouse A 20260603113236057","warehouseCode":"ATW113236057","description":"Source warehouse for API documentation test","address":"API Test Address A"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Warehouse created successfully",
  "timestamp": "2026-06-03T17:02:37.1647231"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### deleteWarehouse

- API Name: deleteWarehouse
- Operation ID: `deleteWarehouse`
- Tag: `warehouse-controller`
- HTTP Method: `DELETE`
- URL: `http://localhost:8081/api/v1/warehouses/3`
- Auth Required: Yes
- Request Schema: `None`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: SKIPPED: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.
- Notes/Fixes: DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.

Headers:

```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
null
```

Curl-style Test Request:

```bash
curl -X DELETE 'http://localhost:8081/api/v1/warehouses/3' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

Success Response JSON:

```json
{
  "notObserved": true,
  "schema": "#/components/schemas/ApiResponseDtoVoid",
  "reason": "Skipped by safe-test policy"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

### updateWarehouse

- API Name: updateWarehouse
- Operation ID: `updateWarehouse`
- Tag: `warehouse-controller`
- HTTP Method: `PUT`
- URL: `http://localhost:8081/api/v1/warehouses/3`
- Auth Required: Yes
- Request Schema: `#/components/schemas/WarehouseRequestDto`
- Response Schema: `#/components/schemas/ApiResponseDtoVoid`
- Test Result: PASS: HTTP 200

Headers:

```json
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

Path Parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer",
      "format": "int64",
      "exclusiveMinimum": 0
    }
  }
]
```

Query Parameters:

```json
[]
```

Request Body JSON:

```json
{
  "name": "API Test Warehouse A 20260603113236057 Updated",
  "warehouseCode": "ATW113236057",
  "description": "Updated source warehouse for API documentation test",
  "address": "API Test Address A"
}
```

Curl-style Test Request:

```bash
curl -X PUT 'http://localhost:8081/api/v1/warehouses/3' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -d '{"name":"API Test Warehouse A 20260603113236057 Updated","warehouseCode":"ATW113236057","description":"Updated source warehouse for API documentation test","address":"API Test Address A"}'
```

Success Response JSON:

```json
{
  "success": true,
  "message": "Warehouse updated successfully",
  "timestamp": "2026-06-03T17:02:37.202282"
}
```

Error Response JSON:

```json
{
  "success": false,
  "message": "Unauthorized access",
  "errorCode": "UNAUTHORIZED",
  "timestamp": "<timestamp>"
}
```

## Suggested Spring Boot Fixes

1. Change `server.port` to `8080` or update client documentation to `8081`. Current runtime is `8081`.
2. Add OpenAPI security overrides for public endpoints so Swagger does not require Bearer for login, user creation, or organization creation.
3. Seed required lookup rows using Flyway, at minimum `payment_methods`, `expense_categories`, and an initial `cash_accounts` row per organization, or expose secured CRUD/list APIs for those lookup tables.
4. Return created resource IDs from POST endpoints or set a `Location` header so clients do not need follow-up searches.
5. Fix cash summary by avoiding writes in read-only transactions. Either create default cash account during organization setup/migration or remove `@Transactional(readOnly = true)` from paths that call `getOrCreateCashAccount()` and initialize explicitly.
6. Log unexpected exceptions in `GlobalExceptionHandler.handleUnexpected` so HTTP 500 defects are diagnosable from server logs.
