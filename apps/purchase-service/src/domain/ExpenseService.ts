import { and, eq } from 'drizzle-orm';
import { expenses, expenseLines, outboxEvents } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

export interface ExpenseLineInput {
  description: string;
  amount: number;
  gstRate?: number | undefined;
  accountId?: number | undefined;
}

export interface CreateExpenseParams {
  tenantId: number;
  branchId: number;
  expenseType: 'RENT' | 'ELECTRICITY' | 'SALARY' | 'FREIGHT' | 'MARKETING' | 'MAINTENANCE' | 'MISC';
  supplierId?: number | undefined;
  expenseDate: Date;
  dueDate?: Date | undefined;
  description?: string | undefined;
  lines: ExpenseLineInput[];
  accountId?: number | undefined;
  notes?: string | undefined;
  createdBy: number;
}

export class ExpenseService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateExpenseParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const computedLines = params.lines.map((l, i) => {
        const gstRate = l.gstRate ?? 0;
        const gstAmount = Math.round((l.amount * gstRate / 100) * 100) / 100;
        const lineTotal = Math.round((l.amount + gstAmount) * 100) / 100;
        return { ...l, lineNumber: i + 1, gstRate, gstAmount, lineTotal };
      });

      const totalAmount = computedLines.reduce((s, l) => s + l.lineTotal, 0);
      const expenseNumber = `EXP-${params.tenantId}-${Date.now()}`;

      const [row] = await trx
        .insert(expenses)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          expenseNumber,
          expenseType: params.expenseType,
          supplierId: params.supplierId,
          status: 'DRAFT',
          expenseDate: params.expenseDate,
          dueDate: params.dueDate,
          description: params.description,
          totalAmount: String(totalAmount),
          accountId: params.accountId,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: expenses.id });

      if (!row) throw new BusinessError('EXPENSE_CREATE_FAILED', 'Failed to create expense');
      const expenseId = row.id;

      await trx.insert(expenseLines).values(
        computedLines.map((l) => ({
          expenseId,
          tenantId: params.tenantId,
          lineNumber: l.lineNumber,
          description: l.description,
          amount: String(l.amount),
          gstRate: String(l.gstRate),
          gstAmount: String(l.gstAmount),
          lineTotal: String(l.lineTotal),
          accountId: l.accountId,
        }))
      );

      return expenseId;
    });
  }

  async submit(id: number, tenantId: number, userId: number): Promise<void> {
    const [expense] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
    if (!expense) throw new NotFoundError('Expense', id);
    if (expense.status !== 'DRAFT')
      throw new BusinessError('INVALID_STATUS', `Cannot submit expense in status ${expense.status}`);

    await this.db
      .update(expenses)
      .set({ status: 'SUBMITTED', updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
  }

  async approve(id: number, tenantId: number, userId: number): Promise<void> {
    const [expense] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
    if (!expense) throw new NotFoundError('Expense', id);
    if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(expense.status))
      throw new BusinessError('INVALID_STATUS', `Cannot approve expense in status ${expense.status}`);

    await this.db
      .update(expenses)
      .set({
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: userId,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));

    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'EXPENSE_APPROVED',
      aggregateType: 'Expense',
      aggregateId: id,
      tenantId,
      payload: { expenseId: id, expenseType: expense.expenseType, totalAmount: expense.totalAmount },
      published: false,
    });
  }

  async pay(
    id: number,
    tenantId: number,
    userId: number,
    params: {
      paymentMode: 'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'UPI';
      paymentDate: Date;
      paymentReference?: string | undefined;
    }
  ): Promise<void> {
    const [expense] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
    if (!expense) throw new NotFoundError('Expense', id);
    if (expense.status !== 'APPROVED')
      throw new BusinessError('INVALID_STATUS', 'Expense must be APPROVED before marking as paid');

    const total = parseFloat(String(expense.totalAmount));

    await this.db
      .update(expenses)
      .set({
        status: 'PAID',
        paidAmount: String(total),
        paymentMode: params.paymentMode,
        paymentDate: params.paymentDate,
        paymentReference: params.paymentReference,
        paidAt: new Date(),
        paidBy: userId,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));

    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'EXPENSE_PAID',
      aggregateType: 'Expense',
      aggregateId: id,
      tenantId,
      payload: {
        expenseId: id,
        expenseType: expense.expenseType,
        totalAmount: expense.totalAmount,
        paymentMode: params.paymentMode,
      },
      published: false,
    });
  }

  async getWithLines(id: number, tenantId: number) {
    const [expense] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
    if (!expense) throw new NotFoundError('Expense', id);

    const lines = await this.db
      .select()
      .from(expenseLines)
      .where(eq(expenseLines.expenseId, id));

    return { ...expense, lines };
  }

  async update(id: number, tenantId: number, userId: number, params: Partial<CreateExpenseParams>): Promise<void> {
    const [expense] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
    if (!expense) throw new NotFoundError('Expense', id);
    if (expense.status !== 'DRAFT')
      throw new BusinessError('INVALID_STATUS', 'Can only edit DRAFT expenses');

    await this.db
      .update(expenses)
      .set({
        description: params.description ?? expense.description,
        notes: params.notes ?? expense.notes,
        dueDate: params.dueDate ?? expense.dueDate,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
  }
}
