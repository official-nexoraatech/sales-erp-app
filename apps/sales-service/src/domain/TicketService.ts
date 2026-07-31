import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  crmCsatResponses,
  crmTicketMessages,
  crmTicketSlaRules,
  crmTickets,
  customers,
  invoices,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] as const;
const DEFAULT_SLA_HOURS = 48;
// A "most recent order" auto-link older than this is unlikely to be what the ticket is
// actually about — a configurable window, not an unbounded lookback.
const RECENT_ORDER_WINDOW_DAYS = 30;

export interface CreateTicketParams {
  tenantId: number;
  // Exactly one of createdBy (staff) / createdByPortalAccountId (CRM-ROADMAP Phase 3, Feature 2
  // — Self-Service Customer Portal) is expected to be set; crm_tickets.created_by was made
  // nullable specifically so a portal-raised ticket doesn't need a fake staff users.id.
  createdBy?: number | undefined;
  createdByPortalAccountId?: number | undefined;
  customerId: number;
  subject: string;
  description?: string | undefined;
  ticketType?: 'COMPLAINT' | 'INQUIRY' | 'RETURN_REQUEST' | 'OTHER' | undefined;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | undefined;
  branchId?: number | undefined;
  linkedInvoiceId?: number | undefined;
}

export interface BreachedTicket {
  id: number;
  ticketNumber: string;
  subject: string;
  assignedTo: number | null;
  customerId: number;
}

/** CRM-ROADMAP Phase 1, Feature 4 — Support & Ticketing. */
export class TicketService {
  /**
   * Most-specific-match-wins scoring over ticketType/customerTier/priority (each nullable on
   * the rule = "any"). Falls back to a hardcoded default so every tenant works before
   * configuring any SLA rules at all.
   */
  static resolveSlaHours(
    rules: Array<{
      ticketType: string | null;
      customerTier: string | null;
      priority: string | null;
      slaHours: number;
      isActive: boolean;
    }>,
    ticket: { ticketType: string; priority: string },
    customerTier: string | null
  ): number {
    let bestScore = -1;
    let bestSlaHours: number | null = null;

    for (const rule of rules) {
      if (!rule.isActive) continue;
      if (rule.ticketType && rule.ticketType !== ticket.ticketType) continue;
      if (rule.priority && rule.priority !== ticket.priority) continue;
      if (rule.customerTier && rule.customerTier !== customerTier) continue;

      const score =
        (rule.ticketType ? 1 : 0) + (rule.priority ? 1 : 0) + (rule.customerTier ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestSlaHours = rule.slaHours;
      }
    }

    return bestSlaHours ?? DEFAULT_SLA_HOURS;
  }

  static async create(
    db: ErpDatabase,
    params: CreateTicketParams
  ): Promise<typeof crmTickets.$inferSelect> {
    const [customer] = await db
      .select({ id: customers.id, customerType: customers.customerType })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.tenantId, params.tenantId)));
    if (!customer) throw new NotFoundError('Customer', params.customerId);

    const ticketType = params.ticketType ?? 'OTHER';
    const priority = params.priority ?? 'MEDIUM';

    let linkedInvoiceId = params.linkedInvoiceId;
    if (!linkedInvoiceId) {
      const cutoff = new Date(Date.now() - RECENT_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const [recentInvoice] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, params.customerId),
            eq(invoices.tenantId, params.tenantId),
            gte(invoices.invoiceDate, cutoff)
          )
        )
        .orderBy(desc(invoices.invoiceDate))
        .limit(1);
      linkedInvoiceId = recentInvoice?.id;
    }

    const rules = await db
      .select()
      .from(crmTicketSlaRules)
      .where(
        and(eq(crmTicketSlaRules.tenantId, params.tenantId), eq(crmTicketSlaRules.isActive, true))
      );
    const slaHours = TicketService.resolveSlaHours(
      rules,
      { ticketType, priority },
      customer.customerType
    );
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    const [created] = await db
      .insert(crmTickets)
      .values({
        tenantId: params.tenantId,
        createdBy: params.createdBy,
        createdByPortalAccountId: params.createdByPortalAccountId,
        ticketNumber: `TKT${Date.now()}`,
        customerId: params.customerId,
        subject: params.subject,
        description: params.description,
        ticketType,
        priority,
        branchId: params.branchId,
        linkedInvoiceId,
        slaDueAt,
      } as unknown as typeof crmTickets.$inferInsert)
      .returning();
    if (!created) throw new Error('Ticket creation failed unexpectedly');
    return created;
  }

  static async addMessage(
    db: ErpDatabase,
    tenantId: number,
    ticketId: number,
    // Null for a portal-authored reply (CRM-ROADMAP Phase 3, Feature 2) — authorName is the
    // denormalized snapshot that already handles "no live users.id to join against" (see this
    // table's own doc comment), so a portal message needs no schema change here.
    authorId: number | null,
    authorName: string,
    visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE',
    body: string
  ): Promise<typeof crmTicketMessages.$inferSelect> {
    const [created] = await db
      .insert(crmTicketMessages)
      .values({ tenantId, ticketId, authorId, authorName, visibility, body })
      .returning();
    if (!created) throw new Error('Ticket message creation failed unexpectedly');
    return created;
  }

  /**
   * Reopening a CLOSED ticket is an explicit action only — never implicit from a new
   * customer reply (Phase 1 spec's stated edge case: decide and document the exact rule).
   * Goes back to IN_PROGRESS (not OPEN) since it already has assignment/history context.
   */
  static async reopen(
    db: ErpDatabase,
    tenantId: number,
    ticketId: number,
    userId: number,
    userName: string
  ): Promise<typeof crmTickets.$inferSelect> {
    const [existing] = await db
      .select()
      .from(crmTickets)
      .where(and(eq(crmTickets.id, ticketId), eq(crmTickets.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('CrmTicket', ticketId);
    if (existing.status !== 'CLOSED') {
      throw new BusinessError('NOT_CLOSED', 'Only a Closed ticket can be reopened');
    }

    const [updated] = await db
      .update(crmTickets)
      .set({
        status: 'IN_PROGRESS',
        closedAt: null,
        reopenedCount: existing.reopenedCount + 1,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(eq(crmTickets.id, ticketId))
      .returning();
    if (!updated) throw new Error('Ticket reopen failed unexpectedly');

    await TicketService.addMessage(
      db,
      tenantId,
      ticketId,
      userId,
      userName,
      'INTERNAL',
      'Ticket reopened.'
    );
    return updated;
  }

  static async recordCsat(
    db: ErpDatabase,
    tenantId: number,
    ticketId: number,
    recordedBy: number,
    rating: number,
    comment: string | undefined
  ): Promise<typeof crmCsatResponses.$inferSelect> {
    const [created] = await db
      .insert(crmCsatResponses)
      .values({ tenantId, ticketId, rating, comment, recordedBy })
      .returning();
    if (!created) throw new Error('CSAT capture failed unexpectedly');
    return created;
  }

  /**
   * Finds every OPEN_STATUSES ticket past its sla_due_at that hasn't already been flagged,
   * marks it breached, and writes a TICKET_SLA_BREACHED outbox event per ticket (full
   * context, not just IDs, per the outbox-payload-completeness convention). Returns the
   * breached list so the caller (scheduler-service's cron job) can dispatch an escalation
   * notification — this service never calls notification-service directly.
   */
  static async sweepSlaBreaches(db: ErpDatabase, tenantId: number): Promise<BreachedTicket[]> {
    const overdue = await db
      .select()
      .from(crmTickets)
      .where(
        and(
          eq(crmTickets.tenantId, tenantId),
          inArray(crmTickets.status, OPEN_STATUSES),
          eq(crmTickets.slaBreached, false),
          lt(crmTickets.slaDueAt, new Date())
        )
      );

    const breached: BreachedTicket[] = [];
    for (const ticket of overdue) {
      await db
        .update(crmTickets)
        .set({ slaBreached: true, updatedAt: new Date() })
        .where(eq(crmTickets.id, ticket.id));

      await db.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'TICKET_SLA_BREACHED',
        aggregateType: 'CrmTicket',
        aggregateId: ticket.id,
        tenantId,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          customerId: ticket.customerId,
          assignedTo: ticket.assignedTo,
          slaDueAt: ticket.slaDueAt,
        },
      });

      breached.push({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        assignedTo: ticket.assignedTo,
        customerId: ticket.customerId,
      });
    }

    return breached;
  }
}
