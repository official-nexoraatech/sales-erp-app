// PG-035: Opening Balance Wizard — full trial-balance validation on POST /opening-balances/lock.
//
// The interesting logic lives in the pure validator (validateOpeningBalanceTrialBalance),
// so most cases below exercise it directly with plain fixture arrays — no DB needed. A
// smaller set of route-level tests confirms the handler wires the validator's result into
// the BusinessError('TRIAL_BALANCE_MISMATCH' / 'OPENING_BALANCE_DOUBLE_ENTRY') envelope and
// the success response correctly.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import {
  validateOpeningBalanceTrialBalance,
  type OpeningBalanceRow,
  type AccountSubTypeLookup,
} from '../domain/OpeningBalanceValidator.js';

// ═══════════════════════════════════════════════════════════════════════════
// validateOpeningBalanceTrialBalance — pure logic
// ═══════════════════════════════════════════════════════════════════════════

describe('validateOpeningBalanceTrialBalance', () => {
  it('includes stock DEBIT total in the overall sum instead of excluding it', () => {
    // Old check excluded STOCK entirely, so this would have "balanced" (10000 DR = 10000 CR
    // from customers/accounts alone) despite the 5000 stock debit having no matching credit.
    const balances: OpeningBalanceRow[] = [
      { entityType: 'CUSTOMER', entityId: 1, amount: '10000', balanceType: 'DEBIT' },
      { entityType: 'ACCOUNT', entityId: 1, amount: '10000', balanceType: 'CREDIT' },
      { entityType: 'STOCK', entityId: 5, amount: '5000', balanceType: 'DEBIT' },
    ];

    const result = validateOpeningBalanceTrialBalance(balances, []);

    expect(result.balanced).toBe(false);
    expect(result.totalDebit).toBe(15000);
    expect(result.totalCredit).toBe(10000);
    expect(result.overallDifference).toBe(5000);
    expect(result.breakdown.stock).toEqual({ debit: 5000, credit: 0 });
  });

  it('rejects double-entry when an Accounts-step account has a sub-ledger-covered accountSubType', () => {
    const balances: OpeningBalanceRow[] = [
      { entityType: 'CUSTOMER', entityId: 1, amount: '5000', balanceType: 'DEBIT' },
      { entityType: 'ACCOUNT', entityId: 42, amount: '5000', balanceType: 'DEBIT' },
      { entityType: 'ACCOUNT', entityId: 43, amount: '10000', balanceType: 'CREDIT' },
    ];
    const accountSubTypes: AccountSubTypeLookup[] = [
      { id: 42, accountSubType: 'ACCOUNTS_RECEIVABLE' }, // duplicates the Customers-step entry
      { id: 43, accountSubType: 'EQUITY' }, // fine — not sub-ledger-covered
    ];

    const result = validateOpeningBalanceTrialBalance(balances, accountSubTypes);

    expect(result.doubleEntryViolations).toEqual([
      { accountId: 42, accountSubType: 'ACCOUNTS_RECEIVABLE', amount: 5000 },
    ]);
  });

  it('locks a genuinely balanced 5-step wizard (stock included, no double-entry)', () => {
    const balances: OpeningBalanceRow[] = [
      { entityType: 'CUSTOMER', entityId: 1, amount: '8000', balanceType: 'DEBIT' },
      { entityType: 'SUPPLIER', entityId: 1, amount: '3000', balanceType: 'CREDIT' },
      { entityType: 'STOCK', entityId: 5, amount: '2000', balanceType: 'DEBIT' },
      { entityType: 'CASH_BANK', entityId: 10, amount: '1000', balanceType: 'DEBIT' },
      { entityType: 'ACCOUNT', entityId: 99, amount: '8000', balanceType: 'CREDIT' }, // owner's capital
    ];
    const accountSubTypes: AccountSubTypeLookup[] = [{ id: 99, accountSubType: 'EQUITY' }];

    const result = validateOpeningBalanceTrialBalance(balances, accountSubTypes);

    expect(result.doubleEntryViolations).toEqual([]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit).toBe(11000);
    expect(result.totalCredit).toBe(11000);
  });

  it('returns a structured per-category breakdown, not just one aggregate number', () => {
    const balances: OpeningBalanceRow[] = [
      { entityType: 'CUSTOMER', entityId: 1, amount: '50000', balanceType: 'DEBIT' },
      { entityType: 'ACCOUNT', entityId: 1, amount: '45000', balanceType: 'CREDIT' },
    ];

    const result = validateOpeningBalanceTrialBalance(balances, []);

    expect(result.breakdown).toEqual({
      customers: { debit: 50000, credit: 0 },
      suppliers: { debit: 0, credit: 0 },
      stock: { debit: 0, credit: 0 },
      accounts: { debit: 0, credit: 45000 },
      cashBank: { debit: 0, credit: 0 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /opening-balances/lock — route wiring
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@erp/db', () => ({
  openingBalances: { __table: 'openingBalances' },
  openingBalancesWizard: { __table: 'openingBalancesWizard' },
  customers: { __table: 'customers' },
  suppliers: { __table: 'suppliers' },
  accounts: { __table: 'accounts', id: 'accounts.id', accountSubType: 'accounts.accountSubType' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conds: unknown[]) => conds),
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}));

const { openingBalancesRoutes } = await import('../api/opening-balances.routes.js');
const { openingBalances, openingBalancesWizard, accounts } = await import('@erp/db');

let privateKey: KeyLike;

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

async function makeToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions: [PERMISSIONS.OPENING_BALANCE_LOCK] })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

function makeCtxFactory(opts: { wizard: unknown; balances: unknown[]; accountSubTypes: unknown[] }) {
  const trx = {
    raw: { update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) },
    insertIntoOutbox: vi.fn().mockResolvedValue(undefined),
  };

  const raw = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(async () => {
          if (table === openingBalancesWizard) return [opts.wizard];
          if (table === openingBalances) return opts.balances;
          if (table === accounts) return opts.accountSubTypes;
          return [];
        }),
      })),
    })),
  };

  return {
    create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
      tenant,
      db: {
        raw,
        transaction: vi.fn(async (fn: (trx: unknown) => Promise<void>) => fn(trx)),
      },
      audit: { log: vi.fn() },
    }),
  } as never;
}

function withStructuredErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _req, reply) => {
    const err = error as { statusCode?: number; code?: string; message?: string; details?: unknown };
    return reply.code(err.statusCode ?? 500).send({ error: { code: err.code, message: err.message, details: err.details } });
  });
}

describe('POST /opening-balances/lock', () => {
  it('fails with TRIAL_BALANCE_MISMATCH + structured breakdown when stock is unmatched', async () => {
    const ctxFactory = makeCtxFactory({
      wizard: { status: 'IN_PROGRESS' },
      balances: [
        { entityType: 'CUSTOMER', entityId: 1, amount: '10000', balanceType: 'DEBIT' },
        { entityType: 'ACCOUNT', entityId: 1, amount: '10000', balanceType: 'CREDIT' },
        { entityType: 'STOCK', entityId: 5, amount: '5000', balanceType: 'DEBIT' },
      ],
      accountSubTypes: [],
    });

    const app = Fastify({ logger: false });
    await openingBalancesRoutes(app, ctxFactory);
    withStructuredErrors(app);

    const token = await makeToken();
    const res = await app.inject({ method: 'POST', url: '/opening-balances/lock', headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string; details: { stock: unknown; overallDifference: number } } };
    expect(body.error.code).toBe('TRIAL_BALANCE_MISMATCH');
    expect(body.error.details.stock).toEqual({ debit: 5000, credit: 0 });
    expect(body.error.details.overallDifference).toBe(5000);
    await app.close();
  });

  it('locks successfully and returns stock-inclusive totals when balanced', async () => {
    const ctxFactory = makeCtxFactory({
      wizard: { status: 'IN_PROGRESS' },
      balances: [
        { entityType: 'CUSTOMER', entityId: 1, amount: '8000', balanceType: 'DEBIT' },
        { entityType: 'STOCK', entityId: 5, amount: '2000', balanceType: 'DEBIT' },
        { entityType: 'ACCOUNT', entityId: 99, amount: '10000', balanceType: 'CREDIT' },
      ],
      accountSubTypes: [{ id: 99, accountSubType: 'EQUITY' }],
    });

    const app = Fastify({ logger: false });
    await openingBalancesRoutes(app, ctxFactory);

    const token = await makeToken();
    const res = await app.inject({ method: 'POST', url: '/opening-balances/lock', headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { totalDebit: number; totalCredit: number } };
    expect(body.data.totalDebit).toBe(10000);
    expect(body.data.totalCredit).toBe(10000);
    await app.close();
  });

  it('rejects double-entry: Accounts step duplicates the Customers step via ACCOUNTS_RECEIVABLE', async () => {
    const ctxFactory = makeCtxFactory({
      wizard: { status: 'IN_PROGRESS' },
      balances: [
        { entityType: 'CUSTOMER', entityId: 1, amount: '5000', balanceType: 'DEBIT' },
        { entityType: 'ACCOUNT', entityId: 42, amount: '5000', balanceType: 'DEBIT' },
        { entityType: 'ACCOUNT', entityId: 43, amount: '10000', balanceType: 'CREDIT' },
      ],
      accountSubTypes: [
        { id: 42, accountSubType: 'ACCOUNTS_RECEIVABLE' },
        { id: 43, accountSubType: 'EQUITY' },
      ],
    });

    const app = Fastify({ logger: false });
    await openingBalancesRoutes(app, ctxFactory);
    withStructuredErrors(app);

    const token = await makeToken();
    const res = await app.inject({ method: 'POST', url: '/opening-balances/lock', headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('OPENING_BALANCE_DOUBLE_ENTRY');
    await app.close();
  });
});
