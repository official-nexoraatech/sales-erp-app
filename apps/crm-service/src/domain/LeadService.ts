import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  crmAssignmentRules,
  crmLeadActivities,
  crmLeads,
  crmTerritoryBranches,
  customers,
  tenants,
  users,
} from '@erp/db';
import type { ErpDatabase, CrmAccount } from '@erp/db';
import { createCircuitBreaker } from '@erp/sdk';
import { BusinessError, NotFoundError } from '@erp/types';
import { AccountService } from './AccountService.js';

const OPEN_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED'] as const;

export interface CaptureLeadInput {
  displayName?: string | undefined;
  companyName?: string | undefined;
  phone: string;
  email?: string | undefined;
  source?:
    | 'WEBSITE'
    | 'REFERRAL'
    | 'WALK_IN'
    | 'SOCIAL_MEDIA'
    | 'ADVERTISEMENT'
    | 'PHONE_INQUIRY'
    | 'OTHER'
    | undefined;
  isB2b?: boolean | undefined;
  notes?: string | undefined;
}

export interface ConvertLeadResult {
  customer: typeof customers.$inferSelect;
  account: CrmAccount | null;
  attachedToExisting: boolean;
}

// CRM/O2C split — customer creation is a genuine O2C write (duplicate-phone check, GSTIN/PAN
// hashing, customerCode generation), and lead.routes.ts's convert endpoint needs the real
// created customer back synchronously (unlike WhatsAppCommerceService's fire-and-forget webhook
// path, which uses an outbox event instead) — so this reaches sales-service's new
// POST /internal/customers endpoint over HTTP, same x-internal-key + circuit-breaker pattern
// already used by customer-360.routes.ts's health-predictions/recommendation-feedback calls.
interface CreateCustomerViaInternalApiParams {
  tenantId: number;
  createdBy: number;
  displayName: string;
  companyName?: string | undefined;
  customerType?: 'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT' | undefined;
  phone: string;
  email?: string | undefined;
  branchId: number;
  convertedFromLeadId?: number | undefined;
}

async function createCustomerViaInternalApi(
  salesServiceUrl: string,
  internalKey: string,
  params: CreateCustomerViaInternalApiParams
): Promise<typeof customers.$inferSelect> {
  const res = await fetch(`${salesServiceUrl}/api/v2/internal/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`sales-service internal customer-create call failed: ${res.status}`);
  const json = (await res.json()) as { data: { customer: typeof customers.$inferSelect } };
  return json.data.customer;
}
const createCustomerBreaker = createCircuitBreaker(createCustomerViaInternalApi, 'sales-service');

/** CRM-ROADMAP Phase 1, Feature 2 — Lead Management & Capture. */
export class LeadService {
  /**
   * Public, unauthenticated capture entrypoint. Never creates a second open lead for a phone
   * number that already has one — instead attaches an activity note to the existing lead and
   * returns it, per the feature's "not a silent duplicate" requirement. Tenant must be ACTIVE;
   * a suspended/closed/unknown tenant fails the same generic way (no tenant-enumeration signal).
   */
  static async capture(
    db: ErpDatabase,
    tenantId: number,
    input: CaptureLeadInput
  ): Promise<{ lead: typeof crmLeads.$inferSelect; duplicate: boolean }> {
    const [tenant] = await db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new BusinessError(
        'CAPTURE_UNAVAILABLE',
        'Lead capture is not available for this account'
      );
    }

    const [existingOpen] = await db
      .select()
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.tenantId, tenantId),
          eq(crmLeads.phone, input.phone),
          inArray(crmLeads.stage, OPEN_STAGES)
        )
      );

    if (existingOpen) {
      await db.insert(crmLeadActivities).values({
        tenantId,
        leadId: existingOpen.id,
        activityType: 'NOTE',
        description: 'Duplicate capture attempt from the same phone number',
      });
      return { lead: existingOpen, duplicate: true };
    }

    const [created] = await db
      .insert(crmLeads)
      .values({
        tenantId,
        displayName: input.displayName,
        companyName: input.companyName,
        phone: input.phone,
        email: input.email,
        source: input.source ?? 'OTHER',
        isB2b: input.isB2b ?? false,
        notes: input.notes,
      } as unknown as typeof crmLeads.$inferInsert)
      .returning();
    if (!created) throw new Error('Lead capture failed unexpectedly');

    await db.insert(crmLeadActivities).values({
      tenantId,
      leadId: created.id,
      activityType: 'NOTE',
      description: `Captured via ${created.source}`,
    });

    return { lead: created, duplicate: false };
  }

  /**
   * Assigns a lead using the best-matching active rule. Resolution order (most-specific-match-
   * wins, same precedent as TicketService.resolveSlaHours): an exact branchId match beats a
   * CRM-ROADMAP Phase 4 (Territory Management) territory match — a rule whose territoryId
   * covers the lead's branch via crm_territory_branches — which beats the tenant-wide fallback
   * (a rule with neither branchId nor territoryId set). Returns null if no active rule or
   * eligible assignee exists — the caller decides whether that's acceptable (lead stays
   * unassigned) rather than this method silently picking an arbitrary user.
   */
  static async autoAssign(
    db: ErpDatabase,
    tenantId: number,
    leadId: number,
    branchId: number | null
  ): Promise<number | null> {
    const rules = await db
      .select()
      .from(crmAssignmentRules)
      .where(and(eq(crmAssignmentRules.tenantId, tenantId), eq(crmAssignmentRules.isActive, true)));
    if (rules.length === 0) return null;

    let territoryIdsForBranch: number[] = [];
    if (branchId !== null) {
      const territoryRows = await db
        .select({ territoryId: crmTerritoryBranches.territoryId })
        .from(crmTerritoryBranches)
        .where(eq(crmTerritoryBranches.branchId, branchId));
      territoryIdsForBranch = territoryRows.map((r) => r.territoryId);
    }

    const rule =
      (branchId !== null ? rules.find((r) => r.branchId === branchId) : undefined) ??
      (territoryIdsForBranch.length > 0
        ? rules.find((r) => r.territoryId !== null && territoryIdsForBranch.includes(r.territoryId))
        : undefined) ??
      rules.find((r) => r.branchId === null && r.territoryId === null);
    if (!rule || rule.assigneeUserIds.length === 0) return null;

    const activeUsers = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, rule.assigneeUserIds)));
    const activeUserIds = new Set(activeUsers.filter((u) => u.isActive).map((u) => u.id));
    if (activeUserIds.size === 0) return null;

    let chosenUserId: number | null = null;

    if (rule.strategy === 'LOAD_BALANCED') {
      const counts = await db
        .select({ assignedTo: crmLeads.assignedTo, count: sql<number>`count(*)::int` })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.tenantId, tenantId),
            inArray(crmLeads.assignedTo, [...activeUserIds]),
            inArray(crmLeads.stage, OPEN_STAGES)
          )
        )
        .groupBy(crmLeads.assignedTo);
      const countByUser = new Map(counts.map((c) => [c.assignedTo, c.count]));
      let minCount = Infinity;
      for (const candidateId of rule.assigneeUserIds) {
        if (!activeUserIds.has(candidateId)) continue;
        const count = countByUser.get(candidateId) ?? 0;
        if (count < minCount) {
          minCount = count;
          chosenUserId = candidateId;
        }
      }
    } else {
      const poolSize = rule.assigneeUserIds.length;
      let idx = rule.lastAssignedIndex;
      for (let attempts = 0; attempts < poolSize; attempts++) {
        idx = (idx + 1) % poolSize;
        const candidateId = rule.assigneeUserIds[idx]!;
        if (activeUserIds.has(candidateId)) {
          chosenUserId = candidateId;
          break;
        }
      }
      if (chosenUserId !== null) {
        await db
          .update(crmAssignmentRules)
          .set({ lastAssignedIndex: idx, updatedAt: new Date() })
          .where(eq(crmAssignmentRules.id, rule.id));
      }
    }

    if (chosenUserId === null) return null;

    await db
      .update(crmLeads)
      .set({ assignedTo: chosenUserId, updatedAt: new Date() })
      .where(and(eq(crmLeads.id, leadId), eq(crmLeads.tenantId, tenantId)));
    await db.insert(crmLeadActivities).values({
      tenantId,
      leadId,
      activityType: 'ASSIGNMENT',
      description: `Auto-assigned via rule "${rule.name}" (${rule.strategy})`,
    });

    return chosenUserId;
  }

  /**
   * Converts a lead to a Customer (+ CRM Account if B2B-flagged, reusing AccountService from
   * Feature 1). If a non-deleted customer with the same phone already exists, the lead attaches
   * to that existing customer instead of creating a duplicate ("offer merge into existing", not
   * a blind duplicate — the feature's stated edge case). Customer creation itself is a real O2C
   * write, so it's delegated to sales-service's internal customer-create endpoint (see the
   * createCustomerBreaker comment above) rather than duplicating CustomerService.create()'s
   * logic here or importing across the service boundary.
   */
  static async convertToCustomer(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    leadId: number,
    branchId: number
  ): Promise<ConvertLeadResult> {
    const [lead] = await db
      .select()
      .from(crmLeads)
      .where(and(eq(crmLeads.id, leadId), eq(crmLeads.tenantId, tenantId)));
    if (!lead) throw new NotFoundError('CrmLead', leadId);
    if (lead.stage === 'CONVERTED') {
      throw new BusinessError('ALREADY_CONVERTED', 'This lead has already been converted');
    }

    const [existingCustomer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          eq(customers.phone, lead.phone),
          isNull(customers.deletedAt)
        )
      );

    let customer: typeof customers.$inferSelect;
    let attachedToExisting = false;
    if (existingCustomer) {
      customer = existingCustomer;
      attachedToExisting = true;
    } else {
      const salesServiceUrl = process.env['SALES_SERVICE_URL'] ?? 'http://localhost:3013';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      customer = await createCustomerBreaker.fire(salesServiceUrl, internalKey, {
        tenantId,
        createdBy: userId,
        displayName: lead.displayName || lead.phone,
        companyName: lead.companyName ?? undefined,
        customerType: lead.isB2b ? 'B2B' : 'RETAIL',
        phone: lead.phone,
        email: lead.email ?? undefined,
        branchId,
        convertedFromLeadId: lead.id,
      });
    }

    let account: CrmAccount | null = null;
    if (lead.isB2b) {
      account = await AccountService.getOrCreateForCustomer(db, tenantId, userId, customer.id);
    }

    const [updatedLead] = await db
      .update(crmLeads)
      .set({
        stage: 'CONVERTED',
        convertedCustomerId: customer.id,
        convertedAccountId: account?.id ?? null,
        convertedAt: new Date(),
        updatedAt: new Date(),
        version: lead.version + 1,
      })
      .where(eq(crmLeads.id, leadId))
      .returning();
    if (!updatedLead) throw new Error('Lead conversion failed unexpectedly');

    await db.insert(crmLeadActivities).values({
      tenantId,
      leadId,
      activityType: 'STAGE_CHANGE',
      fromStage: lead.stage,
      toStage: 'CONVERTED',
      actorId: userId,
      description: attachedToExisting
        ? `Linked to existing customer #${customer.id}`
        : `Converted to new customer #${customer.id}`,
    });

    return { customer, account, attachedToExisting };
  }
}
