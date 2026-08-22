import { and, eq, isNull, or } from 'drizzle-orm';
import { crmAccounts, crmAccountContacts, customers } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import {
  normalizePhone,
  normalizeEmail,
  scoreDuplicateMatch,
  DUPLICATE_MATCH_SUGGESTION_THRESHOLD,
} from '@erp/utils';

export interface DedupeCandidate {
  account: typeof crmAccounts.$inferSelect;
  score: number;
  reasons: string[];
}

/** CRM-ROADMAP Phase 1, Feature 1 — Contact & Account Hierarchy. */
export class AccountService {
  /**
   * Suggested-not-auto-merged duplicate detection. Every candidate comes from an indexed
   * exact-match lookup (gstinHash / primaryPhone / primaryEmail) — never a full-table scan —
   * then scored so a caller can distinguish a near-certain match (GSTIN) from a weak one
   * (name similarity alone), per the feature's "must not be 100%-confidence-only" requirement.
   */
  static async findDuplicateCandidates(
    db: ErpDatabase,
    tenantId: number,
    input: {
      name?: string | undefined;
      gstin?: string | undefined;
      phone?: string | undefined;
      email?: string | undefined;
    },
    gstinHash?: string | null
  ): Promise<DedupeCandidate[]> {
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
    const normalizedEmail = input.email ? normalizeEmail(input.email) : undefined;

    const lookupConditions = [];
    if (gstinHash) lookupConditions.push(eq(crmAccounts.gstinHash, gstinHash));
    if (normalizedPhone) lookupConditions.push(eq(crmAccounts.primaryPhone, normalizedPhone));
    if (normalizedEmail) lookupConditions.push(eq(crmAccounts.primaryEmail, normalizedEmail));
    if (lookupConditions.length === 0) return [];

    const rows = await db
      .select()
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.tenantId, tenantId),
          isNull(crmAccounts.mergedIntoAccountId),
          or(...lookupConditions)
        )
      );

    const candidates: DedupeCandidate[] = rows.map((account) => {
      const { score, reasons } = scoreDuplicateMatch(
        {
          name: input.name,
          gstinHash: gstinHash ?? undefined,
          phone: normalizedPhone,
          email: normalizedEmail,
        },
        account
      );
      return { account, score, reasons };
    });

    return candidates
      .filter((c) => c.score >= DUPLICATE_MATCH_SUGGESTION_THRESHOLD)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Re-points every contact and customer under `sourceId` to `targetId`, then marks the
   * source account merged (never deleted — `mergedIntoAccountId` keeps it traceable). Balances
   * live on individual `customers` rows, which are re-pointed, not merged/deleted themselves —
   * so no outstanding-balance figure is ever dropped by this operation.
   */
  static async merge(
    db: ErpDatabase,
    tenantId: number,
    sourceId: number,
    targetId: number
  ): Promise<{ contactsMoved: number; customersMoved: number }> {
    if (sourceId === targetId) {
      throw new BusinessError('SAME_ACCOUNT', 'Source and target cannot be the same account');
    }

    const [source] = await db
      .select()
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, sourceId),
          eq(crmAccounts.tenantId, tenantId),
          isNull(crmAccounts.mergedIntoAccountId)
        )
      );
    if (!source) throw new NotFoundError('CrmAccount', sourceId);

    const [target] = await db
      .select()
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, targetId),
          eq(crmAccounts.tenantId, tenantId),
          isNull(crmAccounts.mergedIntoAccountId)
        )
      );
    if (!target) throw new NotFoundError('CrmAccount', targetId);

    // A contact's "primary" flag is meaningful per-account — moving a contact across
    // accounts without clearing it could leave two contacts marked primary under the
    // surviving account. Unset it on every moved contact; the surviving account keeps
    // whichever primary contact it already had.
    const movedContacts = await db
      .update(crmAccountContacts)
      .set({ accountId: targetId, isPrimary: false, updatedAt: new Date() })
      .where(
        and(eq(crmAccountContacts.accountId, sourceId), eq(crmAccountContacts.tenantId, tenantId))
      )
      .returning({ id: crmAccountContacts.id });

    const movedCustomers = await db
      .update(customers)
      .set({ accountId: targetId, updatedAt: new Date() })
      .where(and(eq(customers.accountId, sourceId), eq(customers.tenantId, tenantId)))
      .returning({ id: customers.id });

    await db
      .update(crmAccounts)
      .set({ mergedIntoAccountId: targetId, updatedAt: new Date(), version: source.version + 1 })
      .where(eq(crmAccounts.id, sourceId));

    return { contactsMoved: movedContacts.length, customersMoved: movedCustomers.length };
  }

  /**
   * Get-or-create the implicit personal account for a customer taking a B2B-relevant action
   * for the first time (e.g. adding an account contact). Idempotent — if the customer already
   * has an account, that account is returned unchanged rather than a new one being created.
   */
  static async getOrCreateForCustomer(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    customerId: number
  ): Promise<typeof crmAccounts.$inferSelect> {
    const [customer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt)
        )
      );
    if (!customer) throw new NotFoundError('Customer', customerId);

    if (customer.accountId) {
      const [existingAccount] = await db
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, customer.accountId), eq(crmAccounts.tenantId, tenantId)));
      if (existingAccount) return existingAccount;
    }

    const accountTypeMap: Record<string, 'B2B' | 'WHOLESALE' | 'CORPORATE' | 'INDIVIDUAL'> = {
      B2B: 'B2B',
      WHOLESALE: 'WHOLESALE',
      GOVERNMENT: 'CORPORATE',
      EXPORT: 'CORPORATE',
      RETAIL: 'INDIVIDUAL',
    };

    const [created] = await db
      .insert(crmAccounts)
      .values({
        tenantId,
        name: customer.companyName || customer.displayName,
        accountType: accountTypeMap[customer.customerType] ?? 'INDIVIDUAL',
        gstin: customer.gstin,
        gstinHash: customer.gstinHash,
        primaryPhone: customer.phone,
        primaryEmail: customer.email,
        billingAddress: customer.billingAddress,
        isImplicit: true,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('Implicit account creation failed unexpectedly');

    await db
      .update(customers)
      .set({ accountId: created.id, updatedAt: new Date() })
      .where(eq(customers.id, customerId));

    return created;
  }
}
