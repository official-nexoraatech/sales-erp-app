# ERP — Test & Dev Login Credentials

> Keep this file up to date whenever you create new test users.
> Never commit real production credentials here.

---

## Local Dev Environment

**Frontend URLs**
| App | URL |
|-----|-----|
| ERP Web (admin) | http://localhost:5173 |
| POS Terminal | http://localhost:5174 |

**Backend Ports**
| Service | Port |
|---------|------|
| auth-service | 3010 |
| tenant-service | 3011 |
| inventory-service | 3012 |
| sales-service | 3013 |
| notification-service | 3014 |
| report-service | 3015 |
| scheduler-service | 3016 |
| search-service | 3017 |
| gst-service | 3018 |
| accounting-service | 3019 |

---

## Test Tenants

### Tenant 1 — TestCo (Smoke Test Tenant)
Created: 2026-06-30 | Created by: E2E smoke test session

| Field | Value |
|-------|-------|
| **Tenant ID** | `1` |
| **Company Name** | TestCo |
| **Plan** | enterprise |
| **Status** | ACTIVE |

#### Users in Tenant 1

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| **OWNER / Admin** | `admin@testco.com` | `TestAdmin@2026!` | Full permissions, all modules |

**Login payload (API)**
```json
{
  "tenantId": 1,
  "email": "admin@testco.com",
  "password": "TestAdmin@2026!"
}
```

**Login via UI**
- URL: http://localhost:5173/login
- Tenant ID: `1`
- Email: `admin@testco.com`
- Password: `TestAdmin@2026!`

---

## Test Data Created (Tenant 1)

| Entity | ID | Name / Code | Notes |
|--------|----|------------|-------|
| Category | 1 | Sarees | |
| Unit | 1 | Metres | |
| Item | 1 | Banarasi Silk Saree | SKU: BSS-001, HSN: 5007, GST 5% |
| Warehouse | 1 | Main Warehouse | branchId: 1 |
| GST Rate | — | 5% / 18% | Seeded from hsnMaster |
| Customer | 1 | Priya Sharma | GSTIN: 27AABCU9603R1ZX |
| Stock Adjustment | — | +100 units approved | Main Warehouse, Banarasi Silk Saree |
| Invoice | 1 | INV-2026-0001 | CONFIRMED, ₹59,000 (₹50k + 18% GST intrastate) |
| Payment | 1 | — | NEFT, ₹59,000, against Invoice 1 |

---

## Infrastructure Credentials (Local Docker)

| Service | URL | Credentials |
|---------|-----|------------|
| PostgreSQL primary | `localhost:5435` | user: `erp` / pass: `erp_password` / db: `erp` |
| PostgreSQL replica | `localhost:5436` | user: `erp` / pass: `erp_password` / db: `erp` |
| Redis | `localhost:6379` | no auth |
| Kafka | `localhost:29092` | no auth |
| MinIO console | http://localhost:9001 | `minioadmin` / `minioadmin123` |
| Elasticsearch | http://localhost:9200 | no auth (xpack disabled) |
| Jaeger UI | http://localhost:16686 | no auth |
| Prometheus | http://localhost:9090 | no auth |
| Grafana | http://localhost:3001 | `admin` / `admin` (default) |
| Mailhog UI | http://localhost:8025 | no auth |
| Vault | http://localhost:8200 | token: `dev-root-token` |

---

## Adding New Test Users

```bash
# POST http://localhost:3010/users
# Authorization: Bearer <admin_token>

{
  "email": "newuser@testco.com",
  "password": "Password@123!",
  "firstName": "Test",
  "lastName": "User",
  "roleIds": [1],
  "branchIds": [1],
  "primaryBranchId": 1,
  "isActive": true
}
```

Record the new user below:

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| _(add rows here)_ | | | |
