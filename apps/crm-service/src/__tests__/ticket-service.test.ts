// CRM-ROADMAP Phase 1, Feature 4 (Support & Ticketing) — TicketService coverage: SLA due-date
// calculation (most-specific-rule-wins + default fallback), auto-linking the customer's most
// recent order, the internal-vs-customer-visible message split (the critical security/privacy
// boundary this feature adds — get it tested explicitly per the phase doc's own DoD), the
// explicit-only reopen rule, and the SLA-breach sweep.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  invoices,
  crmTickets,
  crmTicketMessages,
  crmTicketSlaRules,
  outboxEvents,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { TicketService } from '../domain/TicketService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('TicketService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_601 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Ticket Test Customer',
        phone: '9300001111',
        customerType: 'RETAIL',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await db.delete(crmTicketMessages).where(eq(crmTicketMessages.tenantId, TEST_TENANT));
    await db.delete(crmTickets).where(eq(crmTickets.tenantId, TEST_TENANT));
    await db.delete(crmTicketSlaRules).where(eq(crmTicketSlaRules.tenantId, TEST_TENANT));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('resolveSlaHours', () => {
    it('falls back to the hardcoded default when no rule matches', () => {
      const hours = TicketService.resolveSlaHours(
        [],
        { ticketType: 'COMPLAINT', priority: 'HIGH' },
        'RETAIL'
      );
      expect(hours).toBe(48);
    });

    it('prefers the most specific matching rule over a more general one', () => {
      const rules = [
        { ticketType: null, customerTier: null, priority: null, slaHours: 72, isActive: true },
        {
          ticketType: 'COMPLAINT',
          customerTier: null,
          priority: null,
          slaHours: 24,
          isActive: true,
        },
        {
          ticketType: 'COMPLAINT',
          customerTier: null,
          priority: 'URGENT',
          slaHours: 4,
          isActive: true,
        },
      ];
      const hours = TicketService.resolveSlaHours(
        rules,
        { ticketType: 'COMPLAINT', priority: 'URGENT' },
        'RETAIL'
      );
      expect(hours).toBe(4);
    });

    it('ignores an inactive rule even if it would otherwise be the best match', () => {
      const rules = [
        {
          ticketType: 'COMPLAINT',
          customerTier: null,
          priority: 'URGENT',
          slaHours: 4,
          isActive: false,
        },
        {
          ticketType: 'COMPLAINT',
          customerTier: null,
          priority: null,
          slaHours: 24,
          isActive: true,
        },
      ];
      const hours = TicketService.resolveSlaHours(
        rules,
        { ticketType: 'COMPLAINT', priority: 'URGENT' },
        'RETAIL'
      );
      expect(hours).toBe(24);
    });
  });

  describe('create', () => {
    it("auto-links the customer's most recent invoice within the window", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: 1,
          customerId,
          invoiceNumber: `TICKET-TEST-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'CONFIRMED',
          subtotal: '1000',
          taxableAmount: '1000',
          grandTotal: '1000',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert)
        .returning();

      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Item arrived damaged',
        ticketType: 'COMPLAINT',
      });

      expect(ticket.linkedInvoiceId).toBe(invoice!.id);
      expect(ticket.slaDueAt).not.toBeNull();
    });

    it('creates a valid ticket with no linked order for a general inquiry', async () => {
      const [freshCustomer] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName: 'No-Order Customer',
          phone: '9300002222',
          customerType: 'RETAIL',
          creditLimit: '0',
          openingBalance: '0',
          createdBy: 1,
        })
        .returning();

      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId: freshCustomer!.id,
        subject: 'General question about store hours',
        ticketType: 'INQUIRY',
      });

      expect(ticket.linkedInvoiceId).toBeFalsy();
      expect(ticket.status).toBe('OPEN');
    });
  });

  describe('message visibility — the critical security boundary', () => {
    it('preserves INTERNAL and CUSTOMER_VISIBLE distinctly through create and fetch, never conflating them', async () => {
      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Visibility test ticket',
      });

      await TicketService.addMessage(
        db,
        TEST_TENANT,
        ticket.id,
        1,
        'Agent Smith',
        'INTERNAL',
        'Internal-only note.'
      );
      await TicketService.addMessage(
        db,
        TEST_TENANT,
        ticket.id,
        1,
        'Agent Smith',
        'CUSTOMER_VISIBLE',
        'Reply visible to the customer.'
      );

      const messages = await db
        .select()
        .from(crmTicketMessages)
        .where(
          and(
            eq(crmTicketMessages.ticketId, ticket.id),
            eq(crmTicketMessages.tenantId, TEST_TENANT)
          )
        );

      expect(messages).toHaveLength(2);
      const internal = messages.find((m) => m.body === 'Internal-only note.');
      const customerVisible = messages.find((m) => m.body === 'Reply visible to the customer.');
      expect(internal?.visibility).toBe('INTERNAL');
      expect(customerVisible?.visibility).toBe('CUSTOMER_VISIBLE');

      // A caller filtering for the customer-visible subset (what a future portal surface
      // would do) must never see the internal note.
      const customerVisibleOnly = messages.filter((m) => m.visibility === 'CUSTOMER_VISIBLE');
      expect(customerVisibleOnly.some((m) => m.body === 'Internal-only note.')).toBe(false);
    });

    it('attributes a message to a since-removed author correctly via the denormalized name snapshot', async () => {
      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Dangling author test',
      });

      // authorId references a user id that doesn't exist in this tenant at all — there's no
      // real FK constraint (this codebase's manual-filter convention), so this must still
      // render correctly via the stored authorName snapshot rather than a live join.
      const message = await TicketService.addMessage(
        db,
        TEST_TENANT,
        ticket.id,
        999999,
        'Former Employee',
        'INTERNAL',
        'Note from someone no longer employed here.'
      );

      expect(message.authorName).toBe('Former Employee');
      expect(message.authorId).toBe(999999);
    });
  });

  describe('reopen', () => {
    it('refuses to reopen a ticket that is not Closed', async () => {
      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Reopen guard test',
      });
      await expect(TicketService.reopen(db, TEST_TENANT, ticket.id, 1, 'Tester')).rejects.toThrow(
        BusinessError
      );
    });

    it('reopens a Closed ticket to In Progress, increments reopenedCount, and logs an internal note', async () => {
      const ticket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Reopen success test',
      });
      await db.update(crmTickets).set({ status: 'CLOSED' }).where(eq(crmTickets.id, ticket.id));

      const reopened = await TicketService.reopen(db, TEST_TENANT, ticket.id, 1, 'Tester');
      expect(reopened.status).toBe('IN_PROGRESS');
      expect(reopened.reopenedCount).toBe(1);
      expect(reopened.closedAt).toBeNull();

      const messages = await db
        .select()
        .from(crmTicketMessages)
        .where(eq(crmTicketMessages.ticketId, ticket.id));
      expect(messages.some((m) => m.visibility === 'INTERNAL' && m.body.includes('reopened'))).toBe(
        true
      );
    });
  });

  describe('sweepSlaBreaches', () => {
    it('flags an overdue open ticket as breached and writes an outbox event, but never a resolved one', async () => {
      const overdueTicket = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Overdue ticket',
      });
      await db
        .update(crmTickets)
        .set({ slaDueAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(crmTickets.id, overdueTicket.id));

      const resolvedButOverdue = await TicketService.create(db, {
        tenantId: TEST_TENANT,
        createdBy: 1,
        customerId,
        subject: 'Resolved but technically overdue',
      });
      await db
        .update(crmTickets)
        .set({ slaDueAt: new Date(Date.now() - 60 * 60 * 1000), status: 'RESOLVED' })
        .where(eq(crmTickets.id, resolvedButOverdue.id));

      const breached = await TicketService.sweepSlaBreaches(db, TEST_TENANT);
      const breachedIds = breached.map((b) => b.id);

      expect(breachedIds).toContain(overdueTicket.id);
      expect(breachedIds).not.toContain(resolvedButOverdue.id);

      const [refetched] = await db
        .select()
        .from(crmTickets)
        .where(eq(crmTickets.id, overdueTicket.id));
      expect(refetched!.slaBreached).toBe(true);

      const events = await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.tenantId, TEST_TENANT),
            eq(outboxEvents.eventType, 'TICKET_SLA_BREACHED')
          )
        );
      expect(events.some((e) => e.aggregateId === overdueTicket.id)).toBe(true);

      // A second sweep must not re-flag or re-fire the event for the same ticket.
      const secondSweep = await TicketService.sweepSlaBreaches(db, TEST_TENANT);
      expect(secondSweep.map((b) => b.id)).not.toContain(overdueTicket.id);
    });
  });
});
