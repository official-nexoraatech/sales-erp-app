import { and, desc, eq, sql } from 'drizzle-orm';
import {
  crmConversations,
  crmConversationMessages,
  crmCannedResponses,
  tenantSenderIdentity,
  customers,
  outboxEvents,
  type CrmConversation,
  type CrmConversationMessage,
  type CrmCannedResponse,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { NotFoundError } from '@erp/types';
import { ulid } from 'ulid';
import { LeadService } from './LeadService.js';

type Channel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'INSTAGRAM';

// CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub). A two-way inbox — inbound
// provider webhooks (WhatsApp/SMS/email) write here, keyed by (tenant, channel,
// externalAddress) so every reply from the same customer on the same channel threads into one
// conversation.
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const candidate =
    typeof err === 'object' && err !== null && 'cause' in err
      ? (err as { cause?: unknown }).cause
      : err;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { code?: unknown }).code === '23505' &&
    (candidate as { constraint_name?: unknown }).constraint_name === constraintName
  );
}

export class ConversationService {
  /** Resolves which tenant an inbound message addressed to `toAddress` belongs to. */
  static async resolveTenantByAddress(
    db: ErpDatabase,
    channel: Channel,
    toAddress: string
  ): Promise<number | null> {
    const [row] = await db
      .select({ tenantId: tenantSenderIdentity.tenantId })
      .from(tenantSenderIdentity)
      .where(
        and(
          eq(tenantSenderIdentity.channel, channel),
          eq(tenantSenderIdentity.senderAddressOrNumber, toAddress)
        )
      );
    return row?.tenantId ?? null;
  }

  private static async resolveOrCreateConversation(
    db: ErpDatabase,
    tenantId: number,
    channel: Channel,
    externalAddress: string,
    senderName: string | undefined
  ): Promise<CrmConversation> {
    const [existing] = await db
      .select()
      .from(crmConversations)
      .where(
        and(
          eq(crmConversations.tenantId, tenantId),
          eq(crmConversations.channel, channel),
          eq(crmConversations.externalAddress, externalAddress)
        )
      );
    if (existing) return existing;

    // Resolve to an existing customer by phone/email; if none, reuse LeadService.capture()
    // verbatim per this feature's own "unknown sender" edge case. LeadService.capture() requires
    // a phone, which phone-based channels always have — an email-only sender with no matching
    // customer stays unresolved (customerId null, surfaced as "Unknown sender" in the inbox UI),
    // the roadmap's own alternative for this same edge case. INSTAGRAM's externalAddress is a
    // Meta-assigned IGSID, not a phone number and not correlatable to customers.phone/email at
    // all — it follows the same "stays unresolved" path as EMAIL rather than being force-fit into
    // LeadService.capture()'s phone field, which would write garbage into a real phone column.
    let customerId: number | null = null;
    if (channel === 'EMAIL' || channel === 'INSTAGRAM') {
      if (channel === 'EMAIL') {
        const [cust] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.email, externalAddress)));
        customerId = cust?.id ?? null;
      }
    } else {
      const [cust] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, externalAddress)));
      customerId = cust?.id ?? null;
      if (!customerId) {
        await LeadService.capture(db, tenantId, {
          displayName: senderName,
          phone: externalAddress,
          source: 'PHONE_INQUIRY',
        });
      }
    }

    const [created] = await db
      .insert(crmConversations)
      .values({ tenantId, customerId, channel, externalAddress })
      .returning();
    if (!created) throw new Error('Conversation creation failed unexpectedly');
    return created;
  }

  /**
   * Idempotently records an inbound message. A provider retry (same providerMessageId) must
   * never create a duplicate message or double-count unreadCount — the DB's own
   * unique(provider, providerMessageId) constraint is the structural guarantee, surfaced here as
   * isDuplicate rather than an opaque insert failure.
   */
  static async recordInboundMessage(
    db: ErpDatabase,
    tenantId: number,
    params: {
      channel: Channel;
      externalAddress: string;
      senderName?: string | undefined;
      body: string;
      mediaUrl?: string | undefined;
      provider: 'META' | 'MSG91' | 'SENDGRID';
      providerMessageId: string;
    }
  ): Promise<{
    conversation: CrmConversation;
    message: CrmConversationMessage;
    isDuplicate: boolean;
  }> {
    const conversation = await ConversationService.resolveOrCreateConversation(
      db,
      tenantId,
      params.channel,
      params.externalAddress,
      params.senderName
    );

    let inserted: CrmConversationMessage | undefined;
    try {
      [inserted] = await db
        .insert(crmConversationMessages)
        .values({
          tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          body: params.body,
          mediaUrl: params.mediaUrl,
          provider: params.provider,
          providerMessageId: params.providerMessageId,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'crm_conversation_messages_provider_message_unique')) {
        const [existingMsg] = await db
          .select()
          .from(crmConversationMessages)
          .where(
            and(
              eq(crmConversationMessages.provider, params.provider),
              eq(crmConversationMessages.providerMessageId, params.providerMessageId)
            )
          );
        if (!existingMsg)
          throw new Error('Duplicate message insert conflicted but no existing row found');
        return { conversation, message: existingMsg, isDuplicate: true };
      }
      throw err;
    }
    if (!inserted) throw new Error('Conversation message creation failed unexpectedly');

    await db
      .update(crmConversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: params.body.slice(0, 300),
        unreadCount: sql`${crmConversations.unreadCount} + 1`,
        updatedAt: new Date(),
        // A closed thread reopens on a new inbound reply rather than silently accumulating
        // messages nobody will see.
        status: conversation.status === 'CLOSED' ? 'OPEN' : conversation.status,
      })
      .where(eq(crmConversations.id, conversation.id));

    await db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'CONVERSATION_MESSAGE_RECEIVED',
      aggregateType: 'CrmConversation',
      aggregateId: conversation.id,
      tenantId,
      payload: { conversationId: conversation.id, channel: params.channel, messageId: inserted.id },
    });

    return { conversation, message: inserted, isDuplicate: false };
  }

  static async sendOutboundReply(
    db: ErpDatabase,
    tenantId: number,
    conversationId: number,
    body: string,
    sentBy: number
  ): Promise<CrmConversationMessage> {
    const conversation = await ConversationService.getConversation(db, tenantId, conversationId);

    const [message] = await db
      .insert(crmConversationMessages)
      .values({
        tenantId,
        conversationId,
        direction: 'OUTBOUND',
        body,
        provider: 'INTERNAL',
        sentBy,
      })
      .returning();
    if (!message) throw new Error('Reply creation failed unexpectedly');

    await db
      .update(crmConversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 300),
        unreadCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(crmConversations.id, conversationId));

    // Best-effort actual delivery via notification-service — a failed send still leaves the
    // reply recorded in the thread; this feature's own performance note asks the INBOUND webhook
    // path to be fast (write + ack), not this outbound reply path, but the same
    // never-block-on-provider discipline applies here too.
    try {
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({
          tenantId,
          channel: conversation.channel,
          recipientPhone:
            conversation.channel !== 'EMAIL' ? conversation.externalAddress : undefined,
          recipientEmail:
            conversation.channel === 'EMAIL' ? conversation.externalAddress : undefined,
          body,
        }),
      });
    } catch {
      // best-effort — see comment above
    }

    return message;
  }

  static async assign(
    db: ErpDatabase,
    tenantId: number,
    conversationId: number,
    userId: number
  ): Promise<CrmConversation> {
    const [updated] = await db
      .update(crmConversations)
      .set({ assignedTo: userId, status: 'ASSIGNED', updatedAt: new Date() })
      .where(and(eq(crmConversations.id, conversationId), eq(crmConversations.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('Conversation', conversationId);
    return updated;
  }

  static async close(
    db: ErpDatabase,
    tenantId: number,
    conversationId: number
  ): Promise<CrmConversation> {
    const [updated] = await db
      .update(crmConversations)
      .set({ status: 'CLOSED', updatedAt: new Date() })
      .where(and(eq(crmConversations.id, conversationId), eq(crmConversations.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('Conversation', conversationId);
    return updated;
  }

  static async markRead(db: ErpDatabase, tenantId: number, conversationId: number): Promise<void> {
    await db
      .update(crmConversations)
      .set({ unreadCount: 0 })
      .where(and(eq(crmConversations.id, conversationId), eq(crmConversations.tenantId, tenantId)));
  }

  static async listConversations(
    db: ErpDatabase,
    tenantId: number,
    filters: {
      status?: 'OPEN' | 'ASSIGNED' | 'CLOSED' | undefined;
      assignedTo?: number | undefined;
    }
  ): Promise<CrmConversation[]> {
    const conditions = [eq(crmConversations.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(crmConversations.status, filters.status));
    if (filters.assignedTo) conditions.push(eq(crmConversations.assignedTo, filters.assignedTo));
    return db
      .select()
      .from(crmConversations)
      .where(and(...conditions))
      .orderBy(desc(crmConversations.lastMessageAt));
  }

  static async getConversation(
    db: ErpDatabase,
    tenantId: number,
    conversationId: number
  ): Promise<CrmConversation> {
    const [row] = await db
      .select()
      .from(crmConversations)
      .where(and(eq(crmConversations.id, conversationId), eq(crmConversations.tenantId, tenantId)));
    if (!row) throw new NotFoundError('Conversation', conversationId);
    return row;
  }

  static async listMessages(
    db: ErpDatabase,
    tenantId: number,
    conversationId: number
  ): Promise<CrmConversationMessage[]> {
    return db
      .select()
      .from(crmConversationMessages)
      .where(
        and(
          eq(crmConversationMessages.tenantId, tenantId),
          eq(crmConversationMessages.conversationId, conversationId)
        )
      )
      .orderBy(crmConversationMessages.createdAt);
  }

  static async listCannedResponses(
    db: ErpDatabase,
    tenantId: number
  ): Promise<CrmCannedResponse[]> {
    return db.select().from(crmCannedResponses).where(eq(crmCannedResponses.tenantId, tenantId));
  }

  static async createCannedResponse(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: { title: string; body: string; channel?: Channel | undefined }
  ): Promise<CrmCannedResponse> {
    const [row] = await db
      .insert(crmCannedResponses)
      .values({
        tenantId,
        title: params.title,
        body: params.body,
        channel: params.channel,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error('Canned response creation failed unexpectedly');
    return row;
  }
}
