# ERP — Test & Dev Login Credentials

> Keep this file up to date whenever you create new test users.
> Never commit real production credentials here.

---

## Local Dev Environment

**Frontend URLs**

| App             | URL                   |
| --------------- | --------------------- |
| ERP Web (admin) | http://localhost:5173 |
| POS Terminal    | http://localhost:5174 |

**Backend Ports** (as of 2026-07-17 — frontends now route through api-gateway, not directly to services)

| Service              | Port |
| -------------------- | ---- |
| api-gateway          | 3000 |
| auth-service         | 3010 |
| tenant-service       | 3011 |
| inventory-service    | 3012 |
| sales-service        | 3013 |
| notification-service | 3014 |
| report-service       | 3015 |
| scheduler-service    | 3016 |
| search-service       | 3017 |
| gst-service          | 3018 |
| accounting-service   | 3019 |
| purchase-service     | 3020 |
| hr-service           | 3021 |
| production-service   | 3022 |
| event-service        | 3023 |

Login goes through the gateway at a doubled prefix: `POST http://127.0.0.1:3000/api/auth/auth/login`
(gateway's `/api/auth` prefix + auth-service's own `/auth/login` route — see `[[gateway_auth_login_path_and_commitlint_scope]]` memory, this is expected, not a bug).

---

## Test Tenants

### Tenant 1 — TestCo — STALE, DO NOT USE

Created 2026-06-30 by the original smoke-test session. This tenant/user no longer exists in
the dev DB as of 2026-07-17 (data has been reset/migrated since). Kept below only as a
historical record of what was originally seeded; do not attempt to log in with these.

| Field            | Value                  |
| ---------------- | ---------------------- |
| **Tenant ID**    | `1` (no longer exists) |
| **Company Name** | TestCo                 |

### Tenant 2 — QA E2E Test Co (current, working)

| Field            | Value          |
| ---------------- | -------------- |
| **Tenant ID**    | `2`            |
| **Company Name** | QA E2E Test Co |
| **Status**       | ACTIVE         |

#### Users in Tenant 2

| Role      | Email                | Password          | Notes                         |
| --------- | -------------------- | ----------------- | ----------------------------- |
| **OWNER** | `owner@qa-e2e.local` | `QaE2eOwner@2026` | Full permissions, all modules |

**Login payload (API, via gateway)**

```json
{
  "tenantId": 2,
  "email": "owner@qa-e2e.local",
  "password": "QaE2eOwner@2026"
}
```

**Login via UI**

- URL: http://localhost:5173/login
- Tenant ID: `2`
- Email: `owner@qa-e2e.local`
- Password: `QaE2eOwner@2026`

---

## Infrastructure Credentials (Local Docker)

| Service            | URL                    | Credentials                                    |
| ------------------ | ---------------------- | ---------------------------------------------- |
| PostgreSQL primary | `localhost:5435`       | user: `erp` / pass: `erp_password` / db: `erp` |
| PostgreSQL replica | `localhost:5436`       | user: `erp` / pass: `erp_password` / db: `erp` |
| Redis              | `localhost:6379`       | no auth                                        |
| Kafka              | `localhost:29092`      | no auth                                        |
| MinIO console      | http://localhost:9001  | `minioadmin` / `minioadmin123`                 |
| Elasticsearch      | http://localhost:9200  | no auth (xpack disabled)                       |
| Jaeger UI          | http://localhost:16686 | no auth                                        |
| Prometheus         | http://localhost:9090  | no auth                                        |
| Grafana            | http://localhost:3001  | `admin` / `admin` (default)                    |
| Mailhog UI         | http://localhost:8025  | no auth                                        |
| Vault              | http://localhost:8200  | token: `dev-root-token`                        |

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

| Role              | Email | Password | Notes |
| ----------------- | ----- | -------- | ----- |
| _(add rows here)_ |       |          |       |
