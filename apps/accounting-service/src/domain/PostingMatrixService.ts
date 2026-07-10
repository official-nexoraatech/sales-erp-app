import { eq, and } from 'drizzle-orm';
import { accounts, postingMatrix } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError } from '@erp/types';
import type { JournalEntry, JournalLine } from './JournalEngine.js';

// Default posting rules per event type (used when no tenant-specific matrix exists)
// Format: { eventType: [{ debitCode, creditCode, description }] }
export const DEFAULT_POSTING_RULES: Record<
  string,
  Array<{ debitCode: string; creditCode: string; description: string }>
> = {
  INVOICE_CONFIRMED: [
    {
      debitCode: '1120',   // Accounts Receivable
      creditCode: '4000',  // Sales Revenue
      description: 'Sales invoice — revenue recognition',
    },
    // GST line handled separately by event payload (CGST + SGST or IGST)
  ],
  INVOICE_CANCELLED: [], // Handled by reversal of original INVOICE_CONFIRMED journal
  PAYMENT_RECEIVED: [
    {
      debitCode: '1010',   // Cash / Bank
      creditCode: '1120',  // Accounts Receivable
      description: 'Customer payment received',
    },
  ],
  SUPPLIER_PAYMENT_MADE: [
    {
      debitCode: '2010',   // Accounts Payable
      creditCode: '1010',  // Cash / Bank
      description: 'Supplier payment made',
    },
  ],
  GRN_APPROVED: [
    {
      debitCode: '1310',   // Inventory Asset
      creditCode: '2010',  // Accounts Payable
      description: 'Goods receipt — inventory addition',
    },
  ],
  COGS_CALCULATED: [
    {
      debitCode: '5000',   // Cost of Goods Sold
      creditCode: '1200',  // Inventory
      description: 'Cost of goods sold',
    },
  ],
  SALE_RETURN_APPROVED: [
    {
      debitCode: '4200',   // Sales Returns & Allowances (Contra Revenue)
      creditCode: '1120',  // Accounts Receivable
      description: 'Sale return approved — credit to customer',
    },
  ],
  EXPENSE_APPROVED: [
    {
      debitCode: '5200',   // Operating Expenses
      creditCode: '2010',  // Accounts Payable
      description: 'Expense approved',
    },
  ],
  EXPENSE_PAID: [
    {
      debitCode: '2010',   // Accounts Payable
      creditCode: '1010',  // Cash / Bank
      description: 'Expense paid',
    },
  ],
  PAYROLL_PROCESSED: [
    {
      debitCode: '5110',   // Salaries Expense
      creditCode: '1010',  // Cash / Bank
      description: 'Salary disbursed',
    },
  ],
  PAYROLL_RUN_APPROVED: [
    {
      debitCode: '6010',   // Salaries and Wages (Expense)
      creditCode: '2310',  // Salary Payable
      description: 'Payroll approved — salary expense accrual',
    },
  ],
  PAYROLL_RUN_DISBURSED: [
    {
      debitCode: '2310',   // Salary Payable
      creditCode: '1010',  // Cash in Hand / Bank
      description: 'Payroll disbursed — salary payable cleared',
    },
  ],
  EMPLOYEE_LOAN_DISBURSED: [
    {
      debitCode: '1340',   // Employee Loans Receivable
      creditCode: '1010',  // Cash in Hand / Bank
      description: 'Employee loan disbursed',
    },
  ],
  STOCK_ADJUSTMENT_LOSS: [
    {
      debitCode: '5300',   // Loss on Stock Damage
      creditCode: '1310',  // Inventory Asset
      description: 'Stock adjustment — damage / loss',
    },
  ],
  CHEQUE_BOUNCED: [
    {
      debitCode: '1120',   // Accounts Receivable (re-debit)
      creditCode: '1010',  // Cash / Bank (reverse the receipt)
      description: 'Cheque bounced — reversal of payment received',
    },
  ],
  RCM_LIABILITY_POSTED: [
    {
      debitCode: '1330',   // RCM Tax Input Credit
      creditCode: '2330',  // RCM Tax Payable
      description: 'RCM liability — self-assessed GST on unregistered vendor purchase',
    },
  ],
};

// GST account codes (these are looked up and split into lines)
const GST_ACCOUNT_CODES = {
  CGST_PAYABLE: '2210',
  SGST_PAYABLE: '2220',
  IGST_PAYABLE: '2230',
  CGST_INPUT: '1410',
  SGST_INPUT: '1420',
  IGST_INPUT: '1430',
};

export interface PostingContext {
  eventType: string;
  description: string;
  referenceType: string;
  referenceId: number;
  amount: number;
  taxableAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  isInterstate?: boolean;
}

export class PostingMatrixService {
  // Build journal entry from event payload using posting matrix.
  // Falls back to DEFAULT_POSTING_RULES when no tenant-specific config exists.
  static async buildJournalEntry(
    db: TenantScopedDatabase,
    tenantId: number,
    ctx: PostingContext
  ): Promise<JournalEntry> {
    // Try tenant-specific matrix first
    const matrixRows = await db.raw
      .select()
      .from(postingMatrix)
      .where(
        and(
          eq(postingMatrix.tenantId, tenantId),
          eq(postingMatrix.eventType, ctx.eventType),
          eq(postingMatrix.isActive, true)
        )
      );

    const rules =
      matrixRows.length > 0
        ? matrixRows.map((r) => ({
            debitCode: r.debitAccountCode,
            creditCode: r.creditAccountCode,
            description: r.description ?? ctx.description,
          }))
        : (DEFAULT_POSTING_RULES[ctx.eventType] ?? []);

    if (rules.length === 0 && !PostingMatrixService.hasGSTLines(ctx)) {
      throw new BusinessError(
        'NO_POSTING_RULES',
        `No posting rules configured for event type: ${ctx.eventType}`
      );
    }

    // Load all referenced accounts
    const allCodes = new Set<string>();
    rules.forEach((r) => { allCodes.add(r.debitCode); allCodes.add(r.creditCode); });
    PostingMatrixService.addGSTCodes(ctx, allCodes);

    const foundAccounts = await db.raw
      .select({ id: accounts.id, accountCode: accounts.accountCode })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId));

    const codeToId = new Map(foundAccounts.map((a) => [a.accountCode, a.id]));

    const lines: JournalLine[] = [];

    for (const rule of rules) {
      const drId = codeToId.get(rule.debitCode);
      const crId = codeToId.get(rule.creditCode);
      if (!drId || !crId) continue; // skip unconfigured accounts gracefully

      // For INVOICE_CONFIRMED: main line is taxable amount, GST lines separate below
      const lineAmount = ctx.taxableAmount !== undefined ? ctx.taxableAmount : ctx.amount;

      lines.push({ accountId: drId, debitAmount: lineAmount, creditAmount: 0, description: rule.description });
      lines.push({ accountId: crId, debitAmount: 0, creditAmount: lineAmount, description: rule.description });
    }

    // Add GST lines for INVOICE_CONFIRMED (split CR side)
    if (ctx.eventType === 'INVOICE_CONFIRMED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_PAYABLE);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_PAYABLE);
        if (cgstId) lines.push({ accountId: cgstId, debitAmount: 0, creditAmount: ctx.cgstAmount, description: 'CGST payable' });
        if (sgstId) lines.push({ accountId: sgstId, debitAmount: 0, creditAmount: ctx.sgstAmount, description: 'SGST payable' });

        // Add to AR debit (GST portion)
        const arId = codeToId.get('1120');
        if (arId) lines.push({ accountId: arId, debitAmount: ctx.cgstAmount + ctx.sgstAmount, creditAmount: 0, description: 'GST receivable from customer' });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_PAYABLE);
        if (igstId) lines.push({ accountId: igstId, debitAmount: 0, creditAmount: ctx.igstAmount, description: 'IGST payable' });

        const arId = codeToId.get('1120');
        if (arId) lines.push({ accountId: arId, debitAmount: ctx.igstAmount, creditAmount: 0, description: 'IGST receivable from customer' });
      }
    }

    // GRN GST input credit (ITC)
    if (ctx.eventType === 'GRN_APPROVED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_INPUT);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_INPUT);
        const apId = codeToId.get('2010');
        if (cgstId) lines.push({ accountId: cgstId, debitAmount: ctx.cgstAmount, creditAmount: 0, description: 'CGST input credit' });
        if (sgstId) lines.push({ accountId: sgstId, debitAmount: ctx.sgstAmount, creditAmount: 0, description: 'SGST input credit' });
        if (apId) lines.push({ accountId: apId, debitAmount: 0, creditAmount: ctx.cgstAmount + ctx.sgstAmount, description: 'GST payable to supplier' });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_INPUT);
        const apId = codeToId.get('2010');
        if (igstId) lines.push({ accountId: igstId, debitAmount: ctx.igstAmount, creditAmount: 0, description: 'IGST input credit' });
        if (apId) lines.push({ accountId: apId, debitAmount: 0, creditAmount: ctx.igstAmount, description: 'IGST payable to supplier' });
      }
    }

    if (lines.length < 2) {
      throw new BusinessError('JOURNAL_INSUFFICIENT_LINES', `Could not build valid journal lines for event ${ctx.eventType} — check Chart of Accounts configuration`);
    }

    return {
      description: ctx.description,
      referenceType: ctx.referenceType,
      referenceId: ctx.referenceId,
      lines,
    };
  }

  private static hasGSTLines(ctx: PostingContext): boolean {
    return (ctx.cgstAmount !== undefined && ctx.cgstAmount > 0) ||
           (ctx.sgstAmount !== undefined && ctx.sgstAmount > 0) ||
           (ctx.igstAmount !== undefined && ctx.igstAmount > 0);
  }

  private static addGSTCodes(ctx: PostingContext, codes: Set<string>): void {
    if (!PostingMatrixService.hasGSTLines(ctx)) return;
    Object.values(GST_ACCOUNT_CODES).forEach((c) => codes.add(c));
  }

  // Seed default posting matrix for a tenant
  static async seedDefaults(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number
  ): Promise<number> {
    let count = 0;
    for (const [eventType, rules] of Object.entries(DEFAULT_POSTING_RULES)) {
      for (const rule of rules) {
        try {
          await db.raw.insert(postingMatrix).values({
            tenantId,
            eventType,
            debitAccountCode: rule.debitCode,
            creditAccountCode: rule.creditCode,
            description: rule.description,
            sortOrder: count,
            isActive: true,
            createdBy: userId,
          } as typeof postingMatrix.$inferInsert).onConflictDoNothing();
          count++;
        } catch {
          // Ignore conflict if already seeded
        }
      }
    }
    return count;
  }
}
