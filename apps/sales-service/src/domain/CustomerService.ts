import { createHash } from 'crypto';
import { customers } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';

export interface CreateCustomerParams {
  tenantId: number;
  createdBy: number;
  displayName: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  companyName?: string | undefined;
  customerType?: 'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT' | undefined;
  gstin?: string | undefined;
  pan?: string | undefined;
  phone: string;
  altPhone?: string | undefined;
  email?: string | undefined;
  dateOfBirth?: string | undefined;
  anniversary?: string | undefined;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | undefined;
  billingAddress?: Record<string, unknown> | undefined;
  shippingAddress?: Record<string, unknown> | undefined;
  branchId: number;
  accountId?: number | undefined;
  // CRM-ROADMAP Phase 1, Feature 2: set when this customer is created via lead conversion.
  convertedFromLeadId?: number | undefined;
  creditLimit?: number | undefined;
  creditDays?: number | undefined;
  creditLimitEnabled?: boolean | undefined;
  openingBalance?: number | undefined;
  openingBalanceType?: 'DEBIT' | 'CREDIT' | undefined;
  priceListId?: number | undefined;
  notes?: string | undefined;
  tags?: string[] | undefined;
  customFields?: Record<string, unknown> | undefined;
  // OFFLINE-05: client-generated idempotency key — see isUniqueViolation below.
  operationId?: string | undefined;
  // CRM-ROADMAP Phase 3, Feature 5 (Multi-language Communication).
  preferredLanguage?: string | undefined;
}

// HMAC-like hash for search — in prod use PlatformContext.encryption.searchHash().
function simpleHash(value: string): string {
  return createHash('sha256').update(value.toUpperCase()).digest('hex').substring(0, 64);
}

// Mirrors InvoiceService.ts's isUniqueViolation — without this translation, a retried
// offline-customer-sync's unique-constraint hit surfaces as an opaque 500 instead of being
// recognized as "already synced, return the existing record."
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint_name?: unknown }).constraint_name === constraintName
  );
}

/**
 * Core customer-creation logic, extracted so both `POST /customers` and Lead conversion
 * (CRM-ROADMAP Phase 1, Feature 2) create a customer exactly the same way — the roadmap's own
 * Feature 2 spec asks for this reuse explicitly ("does not duplicate customer-creation logic").
 */
export class CustomerService {
  static async create(
    db: ErpDatabase,
    params: CreateCustomerParams
  ): Promise<{
    created: typeof customers.$inferSelect;
    warnings: string[];
    alreadyExisted: boolean;
  }> {
    const [dup] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.phone, params.phone),
          eq(customers.tenantId, params.tenantId),
          isNull(customers.deletedAt)
        )
      );

    const warnings: string[] = [];
    if (dup) {
      warnings.push(`Another customer with phone ${params.phone} already exists (id: ${dup.id})`);
    }

    const gstinHash = params.gstin ? simpleHash(params.gstin) : null;
    const panHash = params.pan ? simpleHash(params.pan) : null;
    const customerCode = `CUST${Date.now()}`;

    let created: typeof customers.$inferSelect | undefined;
    try {
      [created] = await db
        .insert(customers)
        .values({
          ...params,
          customerCode,
          createdBy: params.createdBy,
          customerType: params.customerType ?? 'RETAIL',
          gstin: params.gstin || null,
          gstinHash,
          pan: params.pan || null,
          panHash,
          creditLimit: String(params.creditLimit ?? 0),
          creditDays: params.creditDays ?? 0,
          openingBalance: String(params.openingBalance ?? 0),
          openingBalanceType: params.openingBalanceType ?? 'DEBIT',
          tags: params.tags ?? [],
          customFields: params.customFields ?? {},
          clientOperationId: params.operationId,
        } as unknown as typeof customers.$inferInsert)
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'customers_tenant_client_operation_id') && params.operationId) {
        const [existing] = await db
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, params.tenantId),
              eq(customers.clientOperationId, params.operationId)
            )
          );
        if (existing) return { created: existing, warnings: [], alreadyExisted: true };
      }
      throw err;
    }

    if (!created) throw new Error('Customer creation failed unexpectedly');
    return { created, warnings, alreadyExisted: false };
  }
}
