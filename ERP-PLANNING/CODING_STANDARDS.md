# CODING STANDARDS
## Cloth Retail ERP — Developer Reference
### Every line of code in this project follows these standards. No exceptions.

---

## 1. TYPESCRIPT STANDARDS

### 1.1 Configuration (tsconfig.json — all packages)
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "paths": {
      "@erp/sdk": ["../../packages/platform-sdk/src"],
      "@erp/types": ["../../packages/shared-types/src"],
      "@erp/utils": ["../../packages/shared-utils/src"]
    }
  }
}
```

### 1.2 Type Rules
```typescript
// ALWAYS: explicit return types on public functions
async function createInvoice(cmd: CreateInvoiceCommand, ctx: PlatformContext): Promise<Invoice> {}

// NEVER: use `any` — use `unknown` and narrow
function processData(data: unknown): ProcessedData {
  if (!isValidData(data)) throw new ValidationError('Invalid data');
  return data as ProcessedData; // after type guard
}

// ALWAYS: use Zod for runtime validation at API boundaries
const CreateInvoiceSchema = z.object({
  customerId: z.number().int().positive().optional(),
  customerName: z.string().min(2).max(200),
  lines: z.array(InvoiceLineSchema).min(1),
});

// NEVER: type assertion without type guard
const invoice = data as Invoice; // WRONG
// CORRECT: validate first, then use

// ALWAYS: use const assertions for literal types
const INVOICE_STATUS = ['DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'] as const;
type InvoiceStatus = typeof INVOICE_STATUS[number];
```

### 1.3 Null Safety
```typescript
// Use optional chaining and nullish coalescing
const name = customer?.displayName ?? customer?.name ?? 'Unknown';

// Never use non-null assertion (!) without comment explaining why
const element = document.getElementById('root')!; // guaranteed by index.html

// Prefer early return over nested conditions
function processInvoice(invoice: Invoice | null): ProcessedInvoice {
  if (!invoice) throw new NotFoundError('Invoice not found');
  if (invoice.status === 'CANCELLED') throw new BusinessError('Cannot process cancelled invoice');
  // happy path continues here
  return compute(invoice);
}
```

---

## 2. FILE AND FOLDER STRUCTURE (per service)

```
apps/sales-service/
├── src/
│   ├── domain/              # Business logic — NO framework dependencies
│   │   ├── invoice/
│   │   │   ├── Invoice.entity.ts          # Domain entity class
│   │   │   ├── Invoice.repository.ts      # Repository interface
│   │   │   ├── Invoice.service.ts         # Business logic
│   │   │   ├── Invoice.saga.ts            # Saga definition
│   │   │   ├── invoice.events.ts          # Event payload builders
│   │   │   ├── invoice.errors.ts          # Domain-specific errors
│   │   │   └── invoice.rules.ts           # Business rule validations
│   │   └── quotation/
│   ├── application/         # Use cases — orchestrates domain
│   │   ├── invoice/
│   │   │   ├── createInvoice.handler.ts
│   │   │   ├── cancelInvoice.handler.ts
│   │   │   ├── getInvoice.query.ts
│   │   │   └── listInvoices.query.ts
│   ├── infrastructure/      # DB, Kafka, Redis implementations
│   │   ├── db/
│   │   │   ├── invoice.repository.impl.ts
│   │   │   └── schema.ts     # Drizzle schema definitions
│   │   └── kafka/
│   │       └── invoice.consumer.ts
│   ├── api/                 # HTTP layer — thin, only routing + validation
│   │   ├── invoice/
│   │   │   ├── invoice.routes.ts
│   │   │   ├── invoice.schemas.ts    # Zod request/response schemas
│   │   │   └── invoice.controller.ts
│   ├── jobs/                # BullMQ job definitions
│   └── main.ts              # Service entry point
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── package.json
```

---

## 3. NAMING CONVENTIONS

### Files
```
PascalCase:    InvoiceService.ts, CustomerRepository.ts (classes)
camelCase:     createInvoice.handler.ts, listInvoices.query.ts (functions)
kebab-case:    invoice-utils.ts, date-formatter.ts (utilities)
UPPER_SNAKE:   PERMISSIONS.ts, EVENT_TYPES.ts (constants)
```

### Variables and Functions
```typescript
// Variables: camelCase, descriptive nouns
const invoiceTotal = 10000;
const activeCustomers = [...];
const isPaymentOverdue = daysOverdue > 0;

// Functions: camelCase, verb + noun
async function createInvoice()
async function getCustomerById()
async function cancelInvoiceWithReason()
function computeGstAmounts()
function validateCreditLimit()
function formatIndianCurrency()

// Classes: PascalCase
class InvoiceService {}
class CustomerRepository {}
class GSTCalculator {}

// Interfaces: PascalCase, no "I" prefix
interface Invoice {}
interface CreateInvoiceCommand {}
interface InvoiceRepository {}

// Enums: PascalCase for enum, UPPER_SNAKE for values
enum InvoiceStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PAID = 'PAID',
}

// Constants: UPPER_SNAKE_CASE
const MAX_DISCOUNT_PERCENT = 30;
const DEFAULT_CREDIT_DAYS = 30;
const GST_RATES = [0, 5, 12, 18, 28] as const;
```

### Database (Drizzle Schema)
```typescript
// Table names: snake_case plural
export const invoices = pgTable('invoices', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: integer('tenant_id').notNull(),          // camelCase in TS, snake_case in SQL
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
  grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### API Routes
```typescript
// Resource names: kebab-case plural nouns
'/invoices'
'/purchase-orders'
'/stock-transfers'
'/payment-in'
'/credit-notes'

// Action endpoints: POST with verb
POST '/invoices/:id/confirm'
POST '/invoices/:id/cancel'
POST '/purchase-orders/:id/approve'
```

### Events
```
{ENTITY}_{PAST_TENSE_VERB}
INVOICE_CONFIRMED, STOCK_DEDUCTED, PAYMENT_RECEIVED
CUSTOMER_CREDIT_LIMIT_CHANGED, GRN_APPROVED, LEAVE_APPROVED
```

---

## 4. ERROR HANDLING

### 4.1 Error Class Hierarchy
```typescript
// packages/shared-types/src/errors.ts

export class ERPError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends ERPError {
  constructor(message: string, field?: string) {
    super('VALIDATION_ERROR', message, 422, { field });
  }
}

export class NotFoundError extends ERPError {
  constructor(entity: string, id?: number | string) {
    super('NOT_FOUND', `${entity} not found${id ? ` (id: ${id})` : ''}`, 404);
  }
}

export class PermissionError extends ERPError {
  constructor(permission: string) {
    super('PERMISSION_DENIED', `Missing permission: ${permission}`, 403);
  }
}

export class BusinessError extends ERPError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 422, details);
  }
}

export class InsufficientStockError extends BusinessError {
  constructor(itemId: number, requested: number, available: number) {
    super('INSUFFICIENT_STOCK', `Insufficient stock`, { itemId, requested, available });
  }
}

export class CreditLimitExceededError extends BusinessError {
  constructor(customerId: number, creditLimit: number, newBalance: number) {
    super('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', { customerId, creditLimit, newBalance });
  }
}

export class OptimisticLockError extends ERPError {
  constructor(entity: string) {
    super('OPTIMISTIC_LOCK_CONFLICT', `${entity} was modified by another user. Please refresh and retry.`, 409);
  }
}

export class FinancialPeriodClosedError extends BusinessError {
  constructor(period: string) {
    super('FINANCIAL_PERIOD_CLOSED', `Financial period ${period} is closed`, { period });
  }
}
```

### 4.2 Error Handling in Routes
```typescript
// Global error handler in Fastify — auto-converts ERPError to response
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof ERPError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: request.correlationId,
      }
    });
  }
  // Log unexpected errors with full stack trace
  request.log.error({ err: error, correlationId: request.correlationId }, 'Unhandled error');
  return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});
```

---

## 5. LOGGING STANDARDS

```typescript
// NEVER use console.log in service code
// ALWAYS use structured logger from PlatformContext

// In API handlers:
request.log.info({ invoiceId, tenantId, userId }, 'Invoice creation started');
request.log.error({ err, invoiceId }, 'Invoice creation failed');

// In services:
ctx.logger.info({ action: 'STOCK_DEDUCTED', itemId, qty, warehouseId }, 'Stock deducted');

// NEVER log:
// - Passwords or password hashes
// - JWT tokens or refresh tokens
// - API keys or secrets
// - PAN numbers, Aadhaar numbers
// - Full bank account numbers
// - Full GSTIN of customers (log only last 4 chars)

// Log levels:
// ERROR: unhandled exceptions, saga compensation, integration failures
// WARN: retries, validation failures that might indicate issues, slow queries
// INFO: key business events (invoice created, payment received, GRN approved)
// DEBUG: request details, query plans (dev/staging only)
```

---

## 6. TESTING STANDARDS

### 6.1 Test File Location
```
src/domain/invoice/Invoice.service.ts
test/unit/domain/invoice/Invoice.service.test.ts
test/integration/invoice.api.test.ts
test/fixtures/invoice.fixtures.ts
```

### 6.2 Unit Test Pattern
```typescript
describe('InvoiceService', () => {
  describe('createInvoice', () => {
    it('should create invoice with correct GST when CGST+SGST applies', async () => {
      // Arrange
      const ctx = createMockPlatformContext({ tenantId: 1 });
      const cmd: CreateInvoiceCommand = buildInvoiceCommand({
        sellerState: 'MH', placeOfSupply: 'MH', gstRate: 18
      });
      
      // Act
      const result = await invoiceService.createInvoice(cmd, ctx);
      
      // Assert
      expect(result.cgstAmount).toBe(result.sgstAmount);
      expect(result.igstAmount).toBe(0);
      expect(result.cgstAmount + result.sgstAmount).toBe(result.totalGst);
    });
    
    it('should throw InsufficientStockError when stock < requested', async () => {
      // Arrange — stock = 3, requesting 5
      // Act + Assert
      await expect(invoiceService.createInvoice(cmd, ctx))
        .rejects.toThrow(InsufficientStockError);
    });
  });
});
```

### 6.3 Integration Test Pattern
```typescript
describe('POST /api/v2/invoices', () => {
  it('should create invoice and deduct stock atomically', async () => {
    // Uses real DB (test database), real Redis
    // No mocks for infrastructure — real integration
    const stockBefore = await db.items.findById(ITEM_ID);
    
    const response = await request(app)
      .post('/api/v2/invoices')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send(buildValidInvoicePayload());
    
    expect(response.status).toBe(201);
    
    const stockAfter = await db.items.findById(ITEM_ID);
    expect(stockAfter.availableQty).toBe(stockBefore.availableQty - REQUESTED_QTY);
    
    // Verify outbox event was written
    const outboxEvent = await db.outboxEvents.findOne({ aggregateId: response.body.data.id });
    expect(outboxEvent.eventType).toBe('INVOICE_CONFIRMED');
  });
});
```

### 6.4 Coverage Requirements
- Unit tests: 80% minimum line coverage
- Integration tests: all API endpoints covered
- Critical paths: 100% coverage required:
  - Stock deduction (must test concurrent scenario)
  - GST calculation (all 4 cases: CGST+SGST, IGST, exempt, zero-rated)
  - Credit limit enforcement
  - Double-entry balance check

---

## 7. FRONTEND STANDARDS

### 7.1 Component Structure
```
src/
├── pages/
│   └── sales/
│       └── invoices/
│           ├── InvoiceListPage.tsx      # List view with DataTable
│           ├── InvoiceCreatePage.tsx    # Create form
│           ├── InvoiceViewPage.tsx      # Read-only detail
│           └── InvoiceEditPage.tsx      # Edit form
├── components/
│   ├── ui/                              # Generic: Button, Card, Input, Modal
│   └── common/                          # ERP-specific: DataTable, TableExportButtons
├── api/
│   └── endpoints/                       # One file per module: salesApi.ts
├── hooks/
│   └── useInvoices.ts                   # useQuery wrappers per entity
├── types/
│   └── invoice.types.ts
└── utils/
    └── invoice.utils.ts
```

### 7.2 Data Fetching (TanStack React Query)
```typescript
// ALWAYS use useQuery for reads, useMutation for writes
const { data, isLoading, isError } = useQuery({
  queryKey: ['invoices', page, size, search, status],
  queryFn: () => invoiceApi.getAll({ page, size, search, status }),
  staleTime: 30_000,        // 30 seconds before refetch
});

const createMutation = useMutation({
  mutationFn: invoiceApi.create,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    toast.success('Invoice created successfully');
    navigate('/invoices');
  },
  onError: (error: ERPApiError) => {
    toast.error(error.message || 'Failed to create invoice');
  },
});
```

### 7.3 Permission-Gated UI
```typescript
// ALWAYS gate create/edit/delete UI on permissions
const { hasPermission } = useAuth();
const canCreate = hasPermission(PERMISSIONS.INVOICE_CREATE);
const canEdit = hasPermission(PERMISSIONS.INVOICE_UPDATE);
const canDelete = hasPermission(PERMISSIONS.INVOICE_CANCEL);

// In JSX:
{canCreate && <Button onClick={openCreateForm}>Create Invoice</Button>}
{canEdit && <button title="Edit invoice"><Edit size={18} /></button>}
```

### 7.4 Form Validation (React Hook Form + Zod)
```typescript
const schema = z.object({
  customerName: z.string().min(2, 'Name must be at least 2 characters'),
  grandTotal: z.number().positive('Total must be positive'),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, 'Invalid GSTIN').optional(),
});

const form = useForm<InvoiceFormData>({ resolver: zodResolver(schema) });
```

### 7.5 Dark Mode
```typescript
// ThemeContext wraps app — toggles .dark class on <html> element
// All dark mode styles use Tailwind dark: prefix
// Example:
<div className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">
```

### 7.6 Icon Usage (Lucide React)
```typescript
// Import only what you use:
import { Eye, Edit, Trash2, Plus, ArrowLeft, Search } from 'lucide-react';
// Standard sizes: size={16} for table actions, size={18} for buttons, size={20} for section icons
// ALL action icons MUST have title attribute for tooltip
<button title="View invoice"><Eye size={18} /></button>
```

---

## 8. API CLIENT STANDARDS (Frontend)

```typescript
// packages/api/endpoints/invoice.api.ts
import { apiClient } from '../client';
import type { Invoice, CreateInvoiceRequest, PageResponse } from '@erp/types';

export const invoiceApi = {
  getAll: (params: InvoiceListParams) =>
    apiClient.get<PageResponse<Invoice>>('/invoices', { params }),
    
  getById: (id: number) =>
    apiClient.get<Invoice>(`/invoices/${id}`),
    
  create: (data: CreateInvoiceRequest) =>
    apiClient.post<Invoice>('/invoices', data),
    
  update: (id: number, data: UpdateInvoiceRequest) =>
    apiClient.put<Invoice>(`/invoices/${id}`, data),
    
  cancel: (id: number, reason: string) =>
    apiClient.post<Invoice>(`/invoices/${id}/cancel`, { reason }),
    
  exportPdf: (id: number) =>
    apiClient.get<Blob>(`/invoices/${id}/pdf`, { responseType: 'blob' }),
};
```

---

## 9. COMMIT MESSAGE STANDARDS (Conventional Commits)

```
feat(sales): add invoice cancellation with audit trail
fix(inventory): prevent negative stock under concurrent load
feat(gst): implement GSTR-1 JSON export with NIC schema
fix(auth): lock account after 5 failed login attempts
refactor(platform-sdk): extract lock manager into separate class
test(accounting): add double-entry balance verification tests
chore(deps): upgrade drizzle-orm to latest
docs(api): document invoice creation endpoint
perf(search): add GIN index for customer name fuzzy search
security(auth): upgrade password hashing from bcrypt to argon2id
```

---

## 10. DEFINITION OF DONE (DoD)

A feature is DONE only when ALL of the following are true:

- [ ] TypeScript compiles with zero errors (`pnpm tsc --noEmit`)
- [ ] All unit tests pass (`pnpm test`)
- [ ] All integration tests pass
- [ ] Coverage meets threshold (80% overall, 100% for critical paths)
- [ ] ESLint passes with zero warnings
- [ ] API endpoint documented (Zod schema defines it completely)
- [ ] Permission guard added to route
- [ ] Audit log written for state changes
- [ ] Outbox event written (for events that cross service boundaries)
- [ ] Feature flag check added (if feature is flag-controlled)
- [ ] Frontend: permission-gated UI implemented
- [ ] Frontend: loading state handled
- [ ] Frontend: error state handled
- [ ] Frontend: empty state handled
- [ ] Mobile: responsive at all breakpoints
- [ ] Dark mode: all new UI elements have dark: variants
- [ ] Action icons: all have `title` attribute
- [ ] PR reviewed by at least one other engineer
- [ ] Staging deployment verified (smoke test)

---

*Version: 1.0 | This document never gets shorter — only additions allowed*
