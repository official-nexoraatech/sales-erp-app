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
      debitCode: '1120', // Accounts Receivable
      creditCode: '4000', // Sales Revenue
      description: 'Sales invoice — revenue recognition',
    },
    // GST line handled separately by event payload (CGST + SGST or IGST)
  ],
  INVOICE_CANCELLED: [], // Handled by reversal of original INVOICE_CONFIRMED journal
  PAYMENT_RECEIVED: [
    {
      debitCode: '1010', // Cash / Bank
      creditCode: '1120', // Accounts Receivable
      description: 'Customer payment received',
    },
  ],
  SUPPLIER_PAYMENT_MADE: [
    {
      debitCode: '2010', // Accounts Payable
      creditCode: '1010', // Cash / Bank
      description: 'Supplier payment made',
    },
  ],
  GRN_APPROVED: [
    {
      debitCode: '1310', // Inventory Asset
      creditCode: '2010', // Accounts Payable
      description: 'Goods receipt — inventory addition',
    },
  ],
  PURCHASE_RETURN_APPROVED: [
    {
      debitCode: '2010', // Accounts Payable (reduce amount owed to supplier)
      creditCode: '1310', // Inventory Asset (goods leaving, reverse of GRN_APPROVED)
      description: 'Purchase return approved — inventory returned to supplier',
    },
  ],
  COGS_CALCULATED: [
    {
      debitCode: '5000', // Cost of Goods Sold
      creditCode: '1200', // Inventory
      description: 'Cost of goods sold',
    },
  ],
  SALE_RETURN_APPROVED: [
    {
      debitCode: '4900', // Sales Returns (Contra Revenue) — matches default-accounts.ts seed code
      creditCode: '1120', // Accounts Receivable
      description: 'Sale return approved — credit to customer',
    },
  ],
  EXPENSE_APPROVED: [
    {
      debitCode: '5200', // Operating Expenses
      creditCode: '2010', // Accounts Payable
      description: 'Expense approved',
    },
  ],
  EXPENSE_PAID: [
    {
      debitCode: '2010', // Accounts Payable
      creditCode: '1010', // Cash / Bank
      description: 'Expense paid',
    },
  ],
  PAYROLL_PROCESSED: [
    {
      debitCode: '5110', // Salaries Expense
      creditCode: '1010', // Cash / Bank
      description: 'Salary disbursed',
    },
  ],
  PAYROLL_RUN_APPROVED: [
    {
      debitCode: '6010', // Salaries and Wages (Expense)
      creditCode: '2310', // Salary Payable
      description: 'Payroll approved — salary expense accrual',
    },
  ],
  PAYROLL_RUN_DISBURSED: [
    {
      debitCode: '2310', // Salary Payable
      creditCode: '1010', // Cash in Hand / Bank
      description: 'Payroll disbursed — salary payable cleared',
    },
  ],
  EMPLOYEE_LOAN_DISBURSED: [
    {
      debitCode: '1340', // Employee Loans Receivable
      creditCode: '1010', // Cash in Hand / Bank
      description: 'Employee loan disbursed',
    },
  ],
  STOCK_ADJUSTMENT_LOSS: [
    {
      debitCode: '6110', // Stock Adjustment Loss (damage/shortage/theft/expiry)
      creditCode: '1310', // Inventory Asset
      description: 'Stock adjustment — damage / loss',
    },
  ],
  STOCK_ADJUSTMENT_GAIN: [
    {
      debitCode: '1310', // Inventory Asset
      creditCode: '4100', // Other Income
      description: 'Stock adjustment — excess found',
    },
  ],
  CHEQUE_BOUNCED: [
    {
      debitCode: '1120', // Accounts Receivable (re-debit)
      creditCode: '1010', // Cash / Bank (reverse the receipt)
      description: 'Cheque bounced — reversal of payment received',
    },
  ],
  RCM_LIABILITY_POSTED: [
    {
      debitCode: '1330', // RCM Tax Input Credit
      creditCode: '2330', // RCM Tax Payable
      description: 'RCM liability — self-assessed GST on unregistered vendor purchase',
    },
  ],
  // Business Rules Engine, Commission category: fires when CommissionService.approve()
  // transitions a DRAFT commission_ledger row to APPROVED (sales-service) — accrues the
  // liability, not a cash payout (a separate PAID-status action, not yet built, would debit
  // Commission Payable / credit Cash, same shape as PAYROLL_RUN_DISBURSED above).
  COMMISSION_APPROVED: [
    {
      debitCode: '6120', // Sales Commission Expense
      creditCode: '2350', // Commission Payable
      description: 'Sales commission approved — accrual',
    },
  ],
  // Audit finding 2026-07-23: Employee Loans Receivable (1340) was debited once at
  // EMPLOYEE_LOAN_DISBURSED but never credited down as EMIs were collected via payroll —
  // hr-service's applyMonthlyDeduction only decremented its own outstandingBalance column,
  // with no accounting event at all. Additive journal alongside PAYROLL_RUN_APPROVED (same
  // pattern as COGS_CALCULATED alongside INVOICE_CONFIRMED) rather than restructuring the
  // existing simplified payroll posting, which books Salaries Expense at net (not gross) pay.
  EMPLOYEE_LOAN_REPAID: [
    {
      debitCode: '6010', // Salaries and Wages (Expense) — gross pay recovered via loan offset
      creditCode: '1340', // Employee Loans Receivable
      description: 'Employee loan EMI recovered via payroll deduction',
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
  postingDate?: Date;
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
    rules.forEach((r) => {
      allCodes.add(r.debitCode);
      allCodes.add(r.creditCode);
    });
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

      lines.push({
        accountId: drId,
        debitAmount: lineAmount,
        creditAmount: 0,
        description: rule.description,
      });
      lines.push({
        accountId: crId,
        debitAmount: 0,
        creditAmount: lineAmount,
        description: rule.description,
      });
    }

    // Add GST lines for INVOICE_CONFIRMED (split CR side)
    if (ctx.eventType === 'INVOICE_CONFIRMED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_PAYABLE);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_PAYABLE);
        if (cgstId)
          lines.push({
            accountId: cgstId,
            debitAmount: 0,
            creditAmount: ctx.cgstAmount,
            description: 'CGST payable',
          });
        if (sgstId)
          lines.push({
            accountId: sgstId,
            debitAmount: 0,
            creditAmount: ctx.sgstAmount,
            description: 'SGST payable',
          });

        // Add to AR debit (GST portion)
        const arId = codeToId.get('1120');
        if (arId)
          lines.push({
            accountId: arId,
            debitAmount: ctx.cgstAmount + ctx.sgstAmount,
            creditAmount: 0,
            description: 'GST receivable from customer',
          });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_PAYABLE);
        if (igstId)
          lines.push({
            accountId: igstId,
            debitAmount: 0,
            creditAmount: ctx.igstAmount,
            description: 'IGST payable',
          });

        const arId = codeToId.get('1120');
        if (arId)
          lines.push({
            accountId: arId,
            debitAmount: ctx.igstAmount,
            creditAmount: 0,
            description: 'IGST receivable from customer',
          });
      }
    }

    // GRN GST input credit (ITC)
    if (ctx.eventType === 'GRN_APPROVED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_INPUT);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_INPUT);
        const apId = codeToId.get('2010');
        if (cgstId)
          lines.push({
            accountId: cgstId,
            debitAmount: ctx.cgstAmount,
            creditAmount: 0,
            description: 'CGST input credit',
          });
        if (sgstId)
          lines.push({
            accountId: sgstId,
            debitAmount: ctx.sgstAmount,
            creditAmount: 0,
            description: 'SGST input credit',
          });
        if (apId)
          lines.push({
            accountId: apId,
            debitAmount: 0,
            creditAmount: ctx.cgstAmount + ctx.sgstAmount,
            description: 'GST payable to supplier',
          });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_INPUT);
        const apId = codeToId.get('2010');
        if (igstId)
          lines.push({
            accountId: igstId,
            debitAmount: ctx.igstAmount,
            creditAmount: 0,
            description: 'IGST input credit',
          });
        if (apId)
          lines.push({
            accountId: apId,
            debitAmount: 0,
            creditAmount: ctx.igstAmount,
            description: 'IGST payable to supplier',
          });
      }
    }

    // Sale return GST reversal (mirror of the INVOICE_CONFIRMED block above, flipped) — the
    // GST payable originally credited at invoice-confirm time must be debited back down when
    // the goods are returned, same as PURCHASE_RETURN_APPROVED does for input credit below.
    if (ctx.eventType === 'SALE_RETURN_APPROVED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_PAYABLE);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_PAYABLE);
        if (cgstId)
          lines.push({
            accountId: cgstId,
            debitAmount: ctx.cgstAmount,
            creditAmount: 0,
            description: 'CGST payable reversed on sale return',
          });
        if (sgstId)
          lines.push({
            accountId: sgstId,
            debitAmount: ctx.sgstAmount,
            creditAmount: 0,
            description: 'SGST payable reversed on sale return',
          });

        const arId = codeToId.get('1120');
        if (arId)
          lines.push({
            accountId: arId,
            debitAmount: 0,
            creditAmount: ctx.cgstAmount + ctx.sgstAmount,
            description: 'GST portion of return, less owed by customer',
          });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_PAYABLE);
        if (igstId)
          lines.push({
            accountId: igstId,
            debitAmount: ctx.igstAmount,
            creditAmount: 0,
            description: 'IGST payable reversed on sale return',
          });

        const arId = codeToId.get('1120');
        if (arId)
          lines.push({
            accountId: arId,
            debitAmount: 0,
            creditAmount: ctx.igstAmount,
            description: 'IGST portion of return, less owed by customer',
          });
      }
    }

    // Purchase return GST reversal (mirror of the GRN_APPROVED ITC block above, flipped) —
    // the ITC originally claimed at GRN time must be given back when the goods are returned.
    if (ctx.eventType === 'PURCHASE_RETURN_APPROVED' && PostingMatrixService.hasGSTLines(ctx)) {
      if (!ctx.isInterstate && ctx.cgstAmount && ctx.sgstAmount) {
        const cgstId = codeToId.get(GST_ACCOUNT_CODES.CGST_INPUT);
        const sgstId = codeToId.get(GST_ACCOUNT_CODES.SGST_INPUT);
        const apId = codeToId.get('2010');
        if (cgstId)
          lines.push({
            accountId: cgstId,
            debitAmount: 0,
            creditAmount: ctx.cgstAmount,
            description: 'CGST input credit reversed',
          });
        if (sgstId)
          lines.push({
            accountId: sgstId,
            debitAmount: 0,
            creditAmount: ctx.sgstAmount,
            description: 'SGST input credit reversed',
          });
        if (apId)
          lines.push({
            accountId: apId,
            debitAmount: ctx.cgstAmount + ctx.sgstAmount,
            creditAmount: 0,
            description: 'GST portion of return, less owed to supplier',
          });
      } else if (ctx.isInterstate && ctx.igstAmount) {
        const igstId = codeToId.get(GST_ACCOUNT_CODES.IGST_INPUT);
        const apId = codeToId.get('2010');
        if (igstId)
          lines.push({
            accountId: igstId,
            debitAmount: 0,
            creditAmount: ctx.igstAmount,
            description: 'IGST input credit reversed',
          });
        if (apId)
          lines.push({
            accountId: apId,
            debitAmount: ctx.igstAmount,
            creditAmount: 0,
            description: 'IGST portion of return, less owed to supplier',
          });
      }
    }

    if (lines.length < 2) {
      throw new BusinessError(
        'JOURNAL_INSUFFICIENT_LINES',
        `Could not build valid journal lines for event ${ctx.eventType} — check Chart of Accounts configuration`
      );
    }

    return {
      description: ctx.description,
      referenceType: ctx.referenceType,
      referenceId: ctx.referenceId,
      lines,
      ...(ctx.postingDate ? { postingDate: ctx.postingDate } : {}),
    };
  }

  private static hasGSTLines(ctx: PostingContext): boolean {
    return (
      (ctx.cgstAmount !== undefined && ctx.cgstAmount > 0) ||
      (ctx.sgstAmount !== undefined && ctx.sgstAmount > 0) ||
      (ctx.igstAmount !== undefined && ctx.igstAmount > 0)
    );
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
          await db.raw
            .insert(postingMatrix)
            .values({
              tenantId,
              eventType,
              debitAccountCode: rule.debitCode,
              creditAccountCode: rule.creditCode,
              description: rule.description,
              sortOrder: count,
              isActive: true,
              createdBy: userId,
            } as typeof postingMatrix.$inferInsert)
            .onConflictDoNothing();
          count++;
        } catch {
          // Ignore conflict if already seeded
        }
      }
    }
    return count;
  }
}
