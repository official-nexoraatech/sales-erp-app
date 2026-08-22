// CRM-ROADMAP Phase 1, Feature 2 (Lead Management & Capture) — LeadService coverage: capture
// dedupe (never a silent duplicate), round-robin fairness + inactive-user skipping, load-balance
// correctness, and conversion (lead-vs-existing-customer must attach, not blind-duplicate; a
// B2B lead also gets a CRM Account via Feature 1's AccountService).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  crmAccounts,
  crmAssignmentRules,
  crmLeadActivities,
  crmLeads,
  crmTerritories,
  crmTerritoryBranches,
  tenants,
  users,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { LeadService } from '../domain/LeadService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('LeadService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let tenantId: number;
  let branchId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    // CRM/O2C split — convertToCustomer's "no existing customer" path now calls
    // sales-service's POST /internal/customers over HTTP (createCustomerBreaker in
    // LeadService.ts) instead of calling CustomerService.create() in-process. This test suite
    // is about LeadService's own logic (dedupe, assignment, conversion bookkeeping), not
    // sales-service's customer-creation validation, so the mock performs the same real insert
    // CustomerService.create() would (via this test's own db connection) rather than standing
    // up a real sales-service instance.
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes('/internal/customers')) return originalFetch(url, init);
      const body = JSON.parse(init!.body as string) as {
        tenantId: number;
        createdBy: number;
        displayName: string;
        companyName?: string;
        customerType?: string;
        phone: string;
        branchId: number;
        convertedFromLeadId?: number;
      };
      const [created] = await db
        .insert(customers)
        .values({
          tenantId: body.tenantId,
          branchId: body.branchId,
          displayName: body.displayName,
          companyName: body.companyName,
          phone: body.phone,
          customerType: body.customerType ?? 'RETAIL',
          convertedFromLeadId: body.convertedFromLeadId,
          createdBy: body.createdBy,
        } as unknown as typeof customers.$inferInsert)
        .returning();
      return new Response(
        JSON.stringify({ data: { customer: created, warnings: [], alreadyExisted: false } }),
        {
          status: 201,
        }
      );
    });

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'Lead Service Test Tenant',
        slug: `lead-svc-test-${Date.now()}`,
        status: 'ACTIVE',
        contactEmail: 'test@example.com',
      })
      .returning();
    tenantId = tenant!.id;

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
  });

  afterAll(async () => {
    await db.delete(crmLeadActivities).where(eq(crmLeadActivities.tenantId, tenantId));
    await db.delete(crmLeads).where(eq(crmLeads.tenantId, tenantId));
    await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.tenantId, tenantId));
    await db.delete(crmTerritoryBranches).where(eq(crmTerritoryBranches.tenantId, tenantId));
    await db.delete(crmTerritories).where(eq(crmTerritories.tenantId, tenantId));
    await db.delete(crmAccounts).where(eq(crmAccounts.tenantId, tenantId));
    await db.delete(customers).where(eq(customers.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(branches).where(eq(branches.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  describe('capture', () => {
    it('creates a new lead for a fresh phone number', async () => {
      const { lead, duplicate } = await LeadService.capture(db, tenantId, {
        phone: '9111100001',
        displayName: 'Fresh Lead',
      });
      expect(duplicate).toBe(false);
      expect(lead.stage).toBe('NEW');
      expect(lead.phone).toBe('9111100001');
    });

    it('does not create a second open lead for the same phone number — attaches to the existing one instead', async () => {
      const first = await LeadService.capture(db, tenantId, { phone: '9111100002' });
      const second = await LeadService.capture(db, tenantId, { phone: '9111100002' });

      expect(second.duplicate).toBe(true);
      expect(second.lead.id).toBe(first.lead.id);

      const rows = await db.select().from(crmLeads).where(eq(crmLeads.phone, '9111100002'));
      expect(rows.length).toBe(1);
    });

    it('rejects capture for a non-ACTIVE tenant', async () => {
      const [suspendedTenant] = await db
        .insert(tenants)
        .values({
          name: 'Suspended Test Tenant',
          slug: `lead-svc-suspended-${Date.now()}`,
          status: 'SUSPENDED',
          contactEmail: 'suspended@example.com',
        })
        .returning();
      try {
        await expect(
          LeadService.capture(db, suspendedTenant!.id, { phone: '9111100003' })
        ).rejects.toThrow(BusinessError);
      } finally {
        await db.delete(tenants).where(eq(tenants.id, suspendedTenant!.id));
      }
    });
  });

  describe('autoAssign', () => {
    async function makeUser(isActive: boolean) {
      const [user] = await db
        .insert(users)
        .values({
          tenantId,
          email: `lead-test-${Date.now()}-${Math.random()}@example.com`,
          passwordHash: 'x',
          firstName: 'Test',
          lastName: 'User',
          isActive,
        })
        .returning();
      return user!;
    }

    it('round-robin distributes assignments fairly across the pool', async () => {
      const u1 = await makeUser(true);
      const u2 = await makeUser(true);
      const u3 = await makeUser(true);
      const [rule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'RR Rule',
          strategy: 'ROUND_ROBIN',
          assigneeUserIds: [u1.id, u2.id, u3.id],
        })
        .returning();

      const counts = new Map<number, number>();
      for (let i = 0; i < 6; i++) {
        const { lead } = await LeadService.capture(db, tenantId, { phone: `922000${1000 + i}` });
        const assignedTo = await LeadService.autoAssign(db, tenantId, lead.id, null);
        counts.set(assignedTo!, (counts.get(assignedTo!) ?? 0) + 1);
      }

      expect(counts.get(u1.id)).toBe(2);
      expect(counts.get(u2.id)).toBe(2);
      expect(counts.get(u3.id)).toBe(2);

      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, rule!.id));
    });

    it('round-robin skips a deactivated user in the pool', async () => {
      const active1 = await makeUser(true);
      const inactive = await makeUser(false);
      const active2 = await makeUser(true);
      const [rule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'RR Rule With Inactive',
          strategy: 'ROUND_ROBIN',
          assigneeUserIds: [active1.id, inactive.id, active2.id],
        })
        .returning();

      const assigned = new Set<number>();
      for (let i = 0; i < 4; i++) {
        const { lead } = await LeadService.capture(db, tenantId, { phone: `923000${1000 + i}` });
        const assignedTo = await LeadService.autoAssign(db, tenantId, lead.id, null);
        assigned.add(assignedTo!);
      }

      expect(assigned.has(inactive.id)).toBe(false);
      expect(assigned.has(active1.id)).toBe(true);
      expect(assigned.has(active2.id)).toBe(true);

      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, rule!.id));
    });

    it('load-balanced strategy assigns to the currently least-loaded active user', async () => {
      const light = await makeUser(true);
      const heavy = await makeUser(true);
      const [rule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'LB Rule',
          strategy: 'LOAD_BALANCED',
          assigneeUserIds: [heavy.id, light.id],
        })
        .returning();

      // Pre-load `heavy` with 3 open leads directly, `light` with 0.
      for (let i = 0; i < 3; i++) {
        const { lead } = await LeadService.capture(db, tenantId, { phone: `924000${1000 + i}` });
        await db.update(crmLeads).set({ assignedTo: heavy.id }).where(eq(crmLeads.id, lead.id));
      }

      const { lead: newLead } = await LeadService.capture(db, tenantId, { phone: '9240009999' });
      const assignedTo = await LeadService.autoAssign(db, tenantId, newLead.id, null);
      expect(assignedTo).toBe(light.id);

      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, rule!.id));
    });

    // CRM-ROADMAP Phase 4, Feature 4 (Territory Management) — extends the rule-resolution order
    // to consider a territory match, ranked between an exact branch match and the tenant-wide
    // fallback (most-specific-match-wins, same precedent as TicketService.resolveSlaHours).
    it("assigns via a territory-scoped rule when the lead's branch belongs to that territory and no exact-branch rule exists", async () => {
      const territoryBranch = (
        await db
          .insert(branches)
          .values({
            tenantId,
            name: 'Territory Test Branch',
            code: 'TTB',
            isHeadOffice: false,
            isActive: true,
            createdBy: 1,
          })
          .returning()
      )[0]!;
      const [territory] = await db
        .insert(crmTerritories)
        .values({ tenantId, name: 'Territory Rule Test', createdBy: 1 })
        .returning();
      await db
        .insert(crmTerritoryBranches)
        .values({ tenantId, territoryId: territory!.id, branchId: territoryBranch.id });

      const rep = await makeUser(true);
      const [rule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'Territory Rule',
          strategy: 'ROUND_ROBIN',
          territoryId: territory!.id,
          assigneeUserIds: [rep.id],
        })
        .returning();

      const { lead } = await LeadService.capture(db, tenantId, { phone: '9260001111' });
      await db
        .update(crmLeads)
        .set({ branchId: territoryBranch.id })
        .where(eq(crmLeads.id, lead.id));

      const assignedTo = await LeadService.autoAssign(db, tenantId, lead.id, territoryBranch.id);
      expect(assignedTo).toBe(rep.id);

      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, rule!.id));
    });

    it('an exact-branch rule still wins over a territory rule covering the same branch', async () => {
      const territoryBranch = (
        await db
          .insert(branches)
          .values({
            tenantId,
            name: 'Territory Priority Branch',
            code: 'TPB',
            isHeadOffice: false,
            isActive: true,
            createdBy: 1,
          })
          .returning()
      )[0]!;
      const [territory] = await db
        .insert(crmTerritories)
        .values({ tenantId, name: 'Priority Territory', createdBy: 1 })
        .returning();
      await db
        .insert(crmTerritoryBranches)
        .values({ tenantId, territoryId: territory!.id, branchId: territoryBranch.id });

      const territoryRep = await makeUser(true);
      const branchRep = await makeUser(true);
      const [territoryRule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'Territory Rule (should lose)',
          strategy: 'ROUND_ROBIN',
          territoryId: territory!.id,
          assigneeUserIds: [territoryRep.id],
        })
        .returning();
      const [branchRule] = await db
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: 1,
          name: 'Exact Branch Rule (should win)',
          strategy: 'ROUND_ROBIN',
          branchId: territoryBranch.id,
          assigneeUserIds: [branchRep.id],
        })
        .returning();

      const { lead } = await LeadService.capture(db, tenantId, { phone: '9260002222' });
      const assignedTo = await LeadService.autoAssign(db, tenantId, lead.id, territoryBranch.id);
      expect(assignedTo).toBe(branchRep.id);

      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, territoryRule!.id));
      await db.delete(crmAssignmentRules).where(eq(crmAssignmentRules.id, branchRule!.id));
    });
  });

  describe('convertToCustomer', () => {
    it('creates a new customer and marks the lead CONVERTED', async () => {
      const { lead } = await LeadService.capture(db, tenantId, {
        phone: '9250001111',
        displayName: 'Convert Me',
      });
      const result = await LeadService.convertToCustomer(db, tenantId, 1, lead.id, branchId);

      expect(result.attachedToExisting).toBe(false);
      expect(result.customer.phone).toBe('9250001111');
      expect(result.customer.convertedFromLeadId).toBe(lead.id);

      const [updatedLead] = await db.select().from(crmLeads).where(eq(crmLeads.id, lead.id));
      expect(updatedLead!.stage).toBe('CONVERTED');
      expect(updatedLead!.convertedCustomerId).toBe(result.customer.id);
    });

    it('attaches to an existing customer with the same phone instead of creating a duplicate', async () => {
      const [existingCustomer] = await db
        .insert(customers)
        .values({
          tenantId,
          branchId,
          displayName: 'Already A Customer',
          phone: '9250002222',
          creditLimit: '0',
          openingBalance: '0',
          createdBy: 1,
        })
        .returning();

      const { lead } = await LeadService.capture(db, tenantId, { phone: '9250002222' });
      const result = await LeadService.convertToCustomer(db, tenantId, 1, lead.id, branchId);

      expect(result.attachedToExisting).toBe(true);
      expect(result.customer.id).toBe(existingCustomer!.id);

      const allCustomersWithPhone = await db
        .select()
        .from(customers)
        .where(eq(customers.phone, '9250002222'));
      expect(allCustomersWithPhone.length).toBe(1);
    });

    it('also creates a CRM Account for a B2B-flagged lead', async () => {
      const { lead } = await LeadService.capture(db, tenantId, {
        phone: '9250003333',
        companyName: 'B2B Test Co',
        isB2b: true,
      });
      const result = await LeadService.convertToCustomer(db, tenantId, 1, lead.id, branchId);

      expect(result.account).not.toBeNull();
      expect(result.account!.isImplicit).toBe(true);
      expect(result.account!.name).toBe('B2B Test Co');
    });

    it('refuses to convert an already-converted lead', async () => {
      const { lead } = await LeadService.capture(db, tenantId, { phone: '9250004444' });
      await LeadService.convertToCustomer(db, tenantId, 1, lead.id, branchId);
      await expect(
        LeadService.convertToCustomer(db, tenantId, 1, lead.id, branchId)
      ).rejects.toThrow(BusinessError);
    });
  });
});
