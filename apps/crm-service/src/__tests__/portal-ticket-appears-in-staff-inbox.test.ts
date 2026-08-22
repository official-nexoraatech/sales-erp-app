// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal) — proves a portal-created
// ticket (createdBy null, createdByPortalAccountId set) shows up in the staff inbox exactly like
// any staff-created one, since both write into the same crm_tickets table and the staff
// GET /tickets query filters only on tenantId/status/assignee/customerId — never on who created
// the ticket. This is the "ticket-created-via-portal-appears-in-staff-inbox" case from the plan.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, crmTickets } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContextFactory } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { ticketRoutes } from '../api/ticket.routes.js';
import { TicketService } from '../domain/TicketService.js';

const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('a portal-created ticket appears in the staff inbox', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 903_301 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;
  let portalTicketId: number;

  async function staffToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
      email: 'staff@erp.local',
      roles: [],
      permissions: [PERMISSIONS.TICKET_VIEW],
      branchIds: [],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Inbox Branch',
        code: 'IB',
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
        displayName: 'Inbox Customer',
        phone: '9900000020',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    // Mirrors exactly what POST /portal/tickets does: createdBy omitted, createdByPortalAccountId set.
    const created = await TicketService.create(db, {
      tenantId: TEST_TENANT,
      customerId,
      createdByPortalAccountId: 55,
      subject: 'Raised from the customer portal',
      ticketType: 'INQUIRY',
    });
    portalTicketId = created.id;

    const ctxFactory = {
      create: (tenant: { tenantId: number; userId: number }) => ({ db: { raw: db }, tenant }),
    } as unknown as PlatformContextFactory;

    app = Fastify({ logger: false });
    await ticketRoutes(app, ctxFactory);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(crmTickets).where(eq(crmTickets.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('has createdBy null and createdByPortalAccountId set, unlike a staff-created ticket', async () => {
    const [row] = await db.select().from(crmTickets).where(eq(crmTickets.id, portalTicketId));
    expect(row!.createdBy).toBeNull();
    expect(row!.createdByPortalAccountId).toBe(55);
  });

  it('shows up in GET /tickets (the staff inbox) alongside any staff-created ticket', async () => {
    const token = await staffToken();
    const res = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.content as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(portalTicketId);
  });
});
