# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`billTop` — Spring Boot REST backend for the "Sales ERP" / TexMitra multi-tenant billing and inventory
application (`spring.application.name=texmitra`). Java 25, Spring Boot 4.0.6, PostgreSQL, Flyway, Maven.
Package root: `com.nexoraa.billtop`. Paired frontend lives in the sibling directory `../sale-erp-froentend`
(React + Vite + TS) — API contracts (DTO shapes, permission name strings) must stay in sync with it.

## Commands

```bash
# Run the app locally (listens on port 8081, see application.properties)
./mvnw spring-boot:run

# Compile without running
./mvnw compile

# Run the full test suite
./mvnw test

# Run a single test class
./mvnw test -Dtest=BranchServiceTest

# Run a single test method
./mvnw test -Dtest=BranchServiceTest#methodName

# Package (skips nothing by default; runs tests)
./mvnw package
```

There is no separate lint command configured (no Checkstyle/Spotless plugin in `pom.xml`).

## Architecture

### Multi-tenancy: two levels

Data is scoped first by **Organization**, then by **Branch** within an organization. Both scopes are resolved
per-request from the authenticated principal, not from client-supplied IDs in the body:

- `CurrentOrganizationService` reads `organizationId` off the JWT principal (`BillTopUserDetails`).
- `CurrentBranchService` / `BranchContext` (`ThreadLocal`) hold the branch id validated by
  `BranchAuthorizationFilter`, which reads the `X-Branch-Id` request header, checks
  `BillTopUserDetails.hasBranchAccess(branchId)` (admins implicitly have access to every branch in their org;
  staff only to branches they're explicitly assigned via `user_branch_mapping`), and rejects with a 403 JSON
  body otherwise. This filter runs immediately after `JwtAuthenticationFilter` in `SecurityConfig`.
- **Branch scoping is only fully wired for some modules.** Warehouse and Contact (Customer/Supplier) are the
  proven pattern (entity `branch_id` FK, repository filters, service-layer scoping via `CurrentBranchService`).
  Other modules (Item, Category, Brand, Sales, Purchase, Payment, Expense, Stock, Quotation, etc.) are still
  organization-scoped only. When adding branch scoping to a new module, mirror the Warehouse/Contact
  implementation exactly: Flyway migration adding `branch_id` (backfilled to a "Main Branch"), entity FK,
  repository query updates, service methods pulling the id from `CurrentBranchService`.

### Request/response conventions

- Every controller endpoint returns `ApiResponseDto<T>` (success/message/data/timestamp envelope) —
  see `dto/ApiResponseDto.java`. List endpoints return `ApiResponseDto<PageResponseDto<...>>`.
- Controllers are thin: validate (`@Valid`, `jakarta.validation` annotations on path/query params) and delegate
  to a `Service` interface + `ServiceImpl`. Entity <-> DTO conversion goes through MapStruct mappers in
  `mapper/`, not manual field copying.
- Global error handling is centralized in `exception/handler/GlobalExceptionHandler.java`; domain exceptions
  (`ResourceNotFoundException`, `BadRequestException`, `UnauthorizedException`, `AccessDeniedException`,
  `FileStorageException`) extend `ApplicationException` and map to consistent error JSON.

### Entities

All persistent entities extend `entity/BaseEntity.java`, which supplies `id`, `createdBy`/`updatedBy`
(via Spring Data `@CreatedBy`/`@LastModifiedBy`, backed by `audit/AuditAwareImpl.java`), `createdAt`/`updatedAt`,
and a soft-delete flag `isDeleted` (queries/repositories must filter on this — there is no hard delete for
most domain entities).

### Permissions (RBAC)

Fine-grained permission strings (e.g. `BRAND_CREATE`, `EXPENSE_VIEW`) are enforced via Spring Security method
security (`@EnableMethodSecurity`). The full catalog of permissions is defined in
`src/main/resources/permissions-config.yaml` and seeded into the `permissions` table by Flyway migrations
(`V3__insert_permissions.sql` plus later `V*__insert_..._permissions.sql` additions); role-to-permission
assignment lives in `role_permissions`. Naming convention is `[ENTITY]_[ACTION]` — when adding a new
permission, add it to the YAML *and* a new Flyway migration, and keep the string identical to what the
frontend's `PERMISSIONS`/`FEATURE_PERMISSIONS` constants expect. See `PERMISSIONS_DOCUMENTATION.md` for the
full group/action reference.

### Database migrations

Flyway-managed, `src/main/resources/db/migration/V<N>__description.sql`, applied automatically on startup
(`spring.flyway.out-of-order=false`, so new migrations must use the next sequential version number). Schema
baseline is `V1__create_sale_erp_schema.sql`.

### Auth

JWT-based, stateless (`SessionCreationPolicy.STATELESS`). `JwtAuthenticationFilter` populates the
`SecurityContext` from the bearer token; `CustomAuthenticationProvider`/`CustomUserDetailsService` back the
login flow. Public (unauthenticated) endpoints are whitelisted explicitly in `SecurityConfig`
(`/api/v1/auth/**`, `POST /api/v1/organizations`, `POST /api/v1/users`, country/state lookups, Swagger UI).
`/api/v2/admin/**` requires the `SUPER_ADMIN` authority.

### File storage / integrations

- AWS S3 (`config/AwsS3Config.java`) for uploaded files (logos, documents), configured via `app.aws.s3.*`.
- Excel import/export via Apache POI (bulk item/contact import).
- PDF generation (invoices) via OpenPDF.
- WhatsApp document delivery via WATI API (`app.whatsapp.*`) and SMTP email (`spring.mail.*`).

### API docs

springdoc-openapi is wired at `/v3/api-docs` and `/swagger-ui.html`. `API_DOCUMENTATION.md` and
`openapi-local.json` are point-in-time generated snapshots from a prior test run — treat as reference, not
source of truth; regenerate from the running app if the two disagree with current code.

## Known sharp edges (from prior investigation)

- `GET /api/v1/cash/summary` and `GET /api/v1/dashboard/summary` can 500 when no cash account exists yet for
  the org/branch — `FinanceSupport.cashSummary()` attempts to create a cash account inside what should be a
  read-only path.
- Most `create` endpoints return `ApiResponseDto<Void>` (no created id/Location header) — callers must do a
  follow-up list/search to find the new record's id.
