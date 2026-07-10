import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface CogsCalculatedPayload {
  invoiceId: number;
  invoiceNumber: string;
  cogsTotal: string | number;
}

// ES-13: separate journal entry from INVOICE_CONFIRMED's revenue recognition —
// DR Cost of Goods Sold / CR Inventory, posted once inventory-side costing
// (FIFO/WACC) has computed the cost basis for the units sold.
export async function handleCogsCalculated(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as CogsCalculatedPayload;
  const cogsTotal = Number(p.cogsTotal ?? 0);
  if (cogsTotal <= 0) return;

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'COGS_CALCULATED',
      description: `Invoice ${p.invoiceNumber} — cost of goods sold`,
      referenceType: 'INVOICE',
      referenceId: p.invoiceId,
      amount: cogsTotal,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, invoiceId: p.invoiceId }, 'Accounting: COGS_CALCULATED posted');
  } catch (err) {
    logger.error({ err, invoiceId: p.invoiceId }, 'Accounting: failed to post COGS_CALCULATED');
    throw err;
  }
}
