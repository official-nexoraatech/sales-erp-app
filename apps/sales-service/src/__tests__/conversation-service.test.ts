// CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub). DB-backed integration tests
// only — every method here touches Postgres. Skipped without DATABASE_URL, matching every other
// domain-service test file's own convention.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  tenants,
  tenantSenderIdentity,
  crmConversations,
  crmConversationMessages,
  crmLeads,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { ConversationService } from '../domain/ConversationService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)(
  'ConversationService — integration (CRM-ROADMAP Phase 2, Feature 5)',
  () => {
    let db: ReturnType<typeof createDatabaseClient>;
    // LeadService.capture() (called for an unknown WhatsApp/SMS sender) requires a real, ACTIVE
    // row in `tenants` — a bare random tenantId (the convention every other test file in this
    // session uses, since most domain services don't check that table) isn't enough here.
    let TEST_TENANT: number;
    let branchId: number;

    async function makeCustomer(
      displayName: string,
      phone: string,
      email?: string
    ): Promise<number> {
      const [row] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName,
          phone,
          email,
          creditLimit: '0',
          openingBalance: '0',
          createdBy: 1,
        })
        .returning();
      return row!.id;
    }

    beforeAll(async () => {
      db = createDatabaseClient({ url: DB_URL! });

      const [tenant] = await db
        .insert(tenants)
        .values({
          name: 'Inbox Test Tenant',
          slug: `inbox-test-${Date.now()}`,
          status: 'ACTIVE',
          contactEmail: 'inbox-test@example.com',
        })
        .returning();
      TEST_TENANT = tenant!.id;

      const [branch] = await db
        .insert(branches)
        .values({
          tenantId: TEST_TENANT,
          name: 'Inbox Test HO',
          code: 'IHO',
          isHeadOffice: true,
          isActive: true,
          createdBy: 1,
        })
        .returning();
      branchId = branch!.id;

      await db.insert(tenantSenderIdentity).values([
        {
          tenantId: TEST_TENANT,
          channel: 'WHATSAPP',
          senderName: 'Store',
          senderAddressOrNumber: '911234500000',
        },
        {
          tenantId: TEST_TENANT,
          channel: 'EMAIL',
          senderName: 'Store',
          senderAddressOrNumber: 'support@test-tenant.com',
        },
        {
          tenantId: TEST_TENANT,
          channel: 'INSTAGRAM',
          senderName: 'Store',
          senderAddressOrNumber: 'ig-business-account-1',
        },
      ]);
    });

    afterAll(async () => {
      await db
        .delete(crmConversationMessages)
        .where(eq(crmConversationMessages.tenantId, TEST_TENANT));
      await db.delete(crmConversations).where(eq(crmConversations.tenantId, TEST_TENANT));
      await db.delete(crmLeads).where(eq(crmLeads.tenantId, TEST_TENANT));
      await db.delete(tenantSenderIdentity).where(eq(tenantSenderIdentity.tenantId, TEST_TENANT));
      await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
      await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
      await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
    });

    describe('resolveTenantByAddress', () => {
      it('resolves the tenant that owns a channel + address via tenantSenderIdentity', async () => {
        const tenantId = await ConversationService.resolveTenantByAddress(
          db,
          'WHATSAPP',
          '911234500000'
        );
        expect(tenantId).toBe(TEST_TENANT);
      });

      it('returns null for an address no tenant has configured', async () => {
        const tenantId = await ConversationService.resolveTenantByAddress(
          db,
          'WHATSAPP',
          '900000000000'
        );
        expect(tenantId).toBeNull();
      });

      it('resolves the tenant that owns an Instagram business account address', async () => {
        const tenantId = await ConversationService.resolveTenantByAddress(
          db,
          'INSTAGRAM',
          'ig-business-account-1'
        );
        expect(tenantId).toBe(TEST_TENANT);
      });
    });

    describe('recordInboundMessage', () => {
      it('creates a conversation + message for a known customer, resolving customerId', async () => {
        const customerId = await makeCustomer('Known WA Customer', '9199990001');

        const { conversation, message, isDuplicate } =
          await ConversationService.recordInboundMessage(db, TEST_TENANT, {
            channel: 'WHATSAPP',
            externalAddress: '9199990001',
            body: 'Hi, is this in stock?',
            provider: 'META',
            providerMessageId: 'wamid.test001',
          });

        expect(isDuplicate).toBe(false);
        expect(conversation.customerId).toBe(customerId);
        expect(conversation.channel).toBe('WHATSAPP');
        expect(message.direction).toBe('INBOUND');
        expect(message.body).toBe('Hi, is this in stock?');
      });

      it('threads a second message from the same address into the same conversation, incrementing unreadCount', async () => {
        const customerId = await makeCustomer('Threading Customer', '9199990002');

        const first = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990002',
          body: 'First message',
          provider: 'META',
          providerMessageId: 'wamid.thread001',
        });
        const second = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990002',
          body: 'Second message',
          provider: 'META',
          providerMessageId: 'wamid.thread002',
        });

        expect(second.conversation.id).toBe(first.conversation.id);
        const messages = await ConversationService.listMessages(
          db,
          TEST_TENANT,
          first.conversation.id
        );
        expect(messages).toHaveLength(2);

        const reloaded = await ConversationService.getConversation(
          db,
          TEST_TENANT,
          first.conversation.id
        );
        expect(reloaded.unreadCount).toBe(2);
        void customerId;
      });

      it('is idempotent under a simulated provider retry — the same providerMessageId never creates a second message', async () => {
        await makeCustomer('Idempotency Customer', '9199990003');

        const first = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990003',
          body: 'Retry me',
          provider: 'META',
          providerMessageId: 'wamid.retry001',
        });
        const retried = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990003',
          body: 'Retry me',
          provider: 'META',
          providerMessageId: 'wamid.retry001',
        });

        expect(retried.isDuplicate).toBe(true);
        expect(retried.message.id).toBe(first.message.id);

        const messages = await ConversationService.listMessages(
          db,
          TEST_TENANT,
          first.conversation.id
        );
        expect(messages).toHaveLength(1);
        const reloaded = await ConversationService.getConversation(
          db,
          TEST_TENANT,
          first.conversation.id
        );
        expect(reloaded.unreadCount).toBe(1);
      });

      it('creates a lead for an unknown WhatsApp sender (no matching customer)', async () => {
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990099',
          senderName: 'Unknown Person',
          body: 'Do you deliver?',
          provider: 'META',
          providerMessageId: 'wamid.unknown001',
        });

        expect(conversation.customerId).toBeNull();

        const [lead] = await db
          .select()
          .from(crmLeads)
          .where(and(eq(crmLeads.tenantId, TEST_TENANT), eq(crmLeads.phone, '9199990099')));
        expect(lead).toBeTruthy();
        expect(lead!.source).toBe('PHONE_INQUIRY');
      });

      it('leaves an unknown email sender unresolved (customerId null) rather than requiring a phone-based lead', async () => {
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'EMAIL',
          externalAddress: 'unknown@example.com',
          body: 'Question about my order',
          provider: 'SENDGRID',
          providerMessageId: 'email-msg-001',
        });
        expect(conversation.customerId).toBeNull();
        expect(conversation.channel).toBe('EMAIL');
      });

      it('leaves an unknown Instagram sender unresolved (customerId null) rather than writing the IGSID into a lead phone field', async () => {
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'INSTAGRAM',
          externalAddress: '17841400000099',
          body: 'Do you ship internationally?',
          provider: 'META',
          providerMessageId: 'ig-mid-unknown001',
        });
        expect(conversation.customerId).toBeNull();
        expect(conversation.channel).toBe('INSTAGRAM');

        const [lead] = await db
          .select()
          .from(crmLeads)
          .where(and(eq(crmLeads.tenantId, TEST_TENANT), eq(crmLeads.phone, '17841400000099')));
        expect(lead).toBeUndefined();
      });

      it('reopens a CLOSED conversation on a new inbound message', async () => {
        await makeCustomer('Reopen Customer', '9199990005');
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990005',
          body: 'Initial message',
          provider: 'META',
          providerMessageId: 'wamid.reopen001',
        });
        await ConversationService.close(db, TEST_TENANT, conversation.id);
        const closed = await ConversationService.getConversation(db, TEST_TENANT, conversation.id);
        expect(closed.status).toBe('CLOSED');

        await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990005',
          body: 'Following up',
          provider: 'META',
          providerMessageId: 'wamid.reopen002',
        });
        const reopened = await ConversationService.getConversation(
          db,
          TEST_TENANT,
          conversation.id
        );
        expect(reopened.status).toBe('OPEN');
      });
    });

    describe('sendOutboundReply / assign / close', () => {
      it('records an OUTBOUND message and resets unreadCount', async () => {
        await makeCustomer('Reply Customer', '9199990006');
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990006',
          body: 'Hello',
          provider: 'META',
          providerMessageId: 'wamid.reply001',
        });

        const reply = await ConversationService.sendOutboundReply(
          db,
          TEST_TENANT,
          conversation.id,
          'Thanks for reaching out!',
          1
        );
        expect(reply.direction).toBe('OUTBOUND');
        expect(reply.provider).toBe('INTERNAL');

        const reloaded = await ConversationService.getConversation(
          db,
          TEST_TENANT,
          conversation.id
        );
        expect(reloaded.unreadCount).toBe(0);
        expect(reloaded.lastMessagePreview).toBe('Thanks for reaching out!');
      });

      it('assigns a conversation to an agent and closes it', async () => {
        await makeCustomer('Assign Customer', '9199990007');
        const { conversation } = await ConversationService.recordInboundMessage(db, TEST_TENANT, {
          channel: 'WHATSAPP',
          externalAddress: '9199990007',
          body: 'Need help',
          provider: 'META',
          providerMessageId: 'wamid.assign001',
        });

        const assigned = await ConversationService.assign(db, TEST_TENANT, conversation.id, 42);
        expect(assigned.status).toBe('ASSIGNED');
        expect(assigned.assignedTo).toBe(42);

        const closed = await ConversationService.close(db, TEST_TENANT, conversation.id);
        expect(closed.status).toBe('CLOSED');
      });
    });
  }
);
