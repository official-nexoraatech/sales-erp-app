import type { ErpDatabase } from '@erp/db';
import { importJobs, customers, suppliers, items, units, branches } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { createLogger } from '@erp/logger';
import { BusinessError, NotFoundError } from '@erp/types';
import { z } from 'zod';

const logger = createLogger({ serviceName: 'scheduler-service' });

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  transform?: 'TRIM' | 'UPPERCASE' | 'LOWERCASE' | 'DATE_ISO' | 'NUMBER';
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: unknown;
}

export type ImportEntity = 'customer' | 'supplier' | 'item' | 'employee' | 'opening-stock';

// ── Per-entity column definitions ─────────────────────────────────────────────
const ENTITY_SCHEMAS: Record<ImportEntity, z.ZodObject<z.ZodRawShape>> = {
  customer: z.object({
    name: z.string().min(2).max(200),
    phone: z.string().regex(/^\d{10}$/),
    email: z.string().email().optional(),
    gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/).optional(),
    creditLimit: z.coerce.number().min(0).optional(),
    openingBalance: z.coerce.number().optional(),
  }),
  supplier: z.object({
    name: z.string().min(2).max(200),
    phone: z.string().regex(/^\d{10}$/),
    email: z.string().email().optional(),
    gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/).optional(),
    openingBalance: z.coerce.number().optional(),
  }),
  item: z.object({
    name: z.string().min(1).max(200),
    sku: z.string().min(1).max(50),
    salePrice: z.coerce.number().min(0),
    purchasePrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).max(100),
    unit: z.string().min(1),
    category: z.string().optional(),
  }),
  employee: z.object({
    name: z.string().min(2).max(200),
    phone: z.string().regex(/^\d{10}$/),
    designation: z.string().min(1),
    basicSalary: z.coerce.number().min(0),
    joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  'opening-stock': z.object({
    sku: z.string().min(1),
    warehouseCode: z.string().min(1),
    quantity: z.coerce.number().min(0),
    costPrice: z.coerce.number().min(0),
  }),
};

// ── CSV parser (no external deps) ─────────────────────────────────────────────
function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

// ── Transform raw value ────────────────────────────────────────────────────────
function applyTransform(value: string, transform?: ColumnMapping['transform']): string {
  switch (transform) {
    case 'TRIM': return value.trim();
    case 'UPPERCASE': return value.toUpperCase().trim();
    case 'LOWERCASE': return value.toLowerCase().trim();
    case 'DATE_ISO': {
      const d = new Date(value);
      return isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
    }
    case 'NUMBER': return String(parseFloat(value.replace(/,/g, '')));
    default: return value.trim();
  }
}

export class ImportEngine {
  constructor(private readonly db: ErpDatabase) {}

  async createJob(
    tenantId: number,
    userId: number,
    entityType: ImportEntity,
    rawCsv: string,
    fileName: string
  ): Promise<string> {
    const rows = parseCsv(rawCsv);
    if (rows.length === 0) throw new BusinessError('IMPORT_EMPTY', 'CSV file has no data rows');
    if (rows.length > 10_000) throw new BusinessError('IMPORT_TOO_LARGE', 'Max 10,000 rows per import');

    const [newJob] = await this.db.insert(importJobs).values({
      tenantId,
      entityType,
      originalFileName: fileName,
      s3Key: fileName,
      totalRows: rows.length,
      status: 'UPLOADED',
      rollbackData: rows as unknown as Record<string, string>[],
      requestedBy: userId,
      createdBy: userId,
    } as unknown as typeof importJobs.$inferInsert).returning({ id: importJobs.id });
    if (!newJob) throw new Error('Import job creation failed');
    const jobId = String(newJob.id);

    logger.info({ tenantId, jobId, entityType, rows: rows.length }, 'Import job created');
    return jobId;
  }

  async mapColumns(
    tenantId: number,
    jobId: string,
    mappings: ColumnMapping[]
  ): Promise<void> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);
    if (job.status !== 'UPLOADED') {
      throw new BusinessError('IMPORT_INVALID_STATE', `Cannot map columns in state: ${job.status}`);
    }

    await this.db
      .update(importJobs)
      .set({ status: 'MAPPED', columnMapping: Object.fromEntries(mappings.map((m) => [m.sourceColumn, m.targetField])) })
      .where(eq(importJobs.id, Number(jobId)));
  }

  async validate(tenantId: number, jobId: string): Promise<{ errors: ValidationError[]; validRows: number }> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);
    if (job.status !== 'MAPPED') {
      throw new BusinessError('IMPORT_INVALID_STATE', `Cannot validate in state: ${job.status}`);
    }

    await this.db.update(importJobs).set({ status: 'VALIDATING' }).where(eq(importJobs.id, Number(jobId)));

    const rawRows = (job.rollbackData ?? []) as Array<Record<string, string>>;
    const mappings = job.columnMapping as unknown as ColumnMapping[];
    const schema = ENTITY_SCHEMAS[job.entityType as ImportEntity];

    const errors: ValidationError[] = [];
    let validRows = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i]!;
      const mapped: Record<string, unknown> = {};

      for (const m of mappings) {
        mapped[m.targetField] = applyTransform(raw[m.sourceColumn] ?? '', m.transform);
      }

      const result = schema.safeParse(mapped);
      if (result.success) {
        validRows++;
      } else {
        for (const issue of result.error.issues) {
          errors.push({
            row: i + 2,
            field: issue.path.join('.'),
            message: issue.message,
            value: mapped[issue.path[0] as string],
          });
        }
      }
    }

    const newStatus = errors.length === 0 ? 'VALIDATED' : 'MAPPED';
    await this.db
      .update(importJobs)
      .set({ status: newStatus, validationErrors: errors.map((e) => ({ row: e.row, column: e.field, value: e.value, message: e.message })) })
      .where(eq(importJobs.id, Number(jobId)));

    return { errors, validRows };
  }

  async execute(
    tenantId: number,
    jobId: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ imported: number; failed: number }> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);
    if (job.status !== 'VALIDATED') {
      throw new BusinessError('IMPORT_INVALID_STATE', `Cannot execute in state: ${job.status}`);
    }

    await this.db.update(importJobs).set({ status: 'EXECUTING', startedAt: new Date() }).where(eq(importJobs.id, Number(jobId)));

    const rawRows = (job.rollbackData ?? []) as Array<Record<string, string>>;
    const mappings = job.columnMapping as unknown as ColumnMapping[];
    const schema = ENTITY_SCHEMAS[job.entityType as ImportEntity];
    const entityType = job.entityType as ImportEntity;

    // Resolve head-office branch for tenant (needed for customer/supplier inserts)
    const [headOfficeBranch] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)))
      .limit(1);
    const defaultBranchId = headOfficeBranch?.id ?? 1;

    // Pre-fetch unit name→id map for item imports
    let unitNameToId = new Map<string, number>();
    if (entityType === 'item') {
      const allUnits = await this.db
        .select({ id: units.id, name: units.name })
        .from(units)
        .where(eq(units.tenantId, tenantId));
      for (const u of allUnits) {
        unitNameToId.set(u.name.toLowerCase(), u.id);
      }
    }

    let imported = 0;
    let failed = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < rawRows.length; i += BATCH_SIZE) {
      const batchRaw = rawRows.slice(i, i + BATCH_SIZE);
      const parsedBatch: Array<ReturnType<typeof schema.parse>> = [];

      for (const raw of batchRaw) {
        try {
          const mapped: Record<string, unknown> = {};
          for (const m of mappings) {
            mapped[m.targetField] = applyTransform(raw[m.sourceColumn] ?? '', m.transform);
          }
          parsedBatch.push(schema.parse(mapped));
        } catch {
          failed++;
        }
      }

      if (parsedBatch.length === 0) {
        onProgress?.(Math.min(i + BATCH_SIZE, rawRows.length), rawRows.length);
        continue;
      }

      try {
        if (entityType === 'customer') {
          await this.db
            .insert(customers)
            .values(
              parsedBatch.map((row) => {
                const r = row as { name: string; phone: string; email?: string; gstin?: string; creditLimit?: number; openingBalance?: number };
                return {
                  tenantId,
                  branchId: defaultBranchId,
                  displayName: r.name,
                  phone: r.phone,
                  email: r.email ?? null,
                  gstin: r.gstin ?? null,
                  creditLimit: String(r.creditLimit ?? 0),
                  openingBalance: String(r.openingBalance ?? 0),
                  createdBy: job.createdBy,
                };
              })
            )
            .onConflictDoNothing();
          imported += parsedBatch.length;
        } else if (entityType === 'supplier') {
          await this.db
            .insert(suppliers)
            .values(
              parsedBatch.map((row) => {
                const r = row as { name: string; phone: string; email?: string; gstin?: string; openingBalance?: number };
                return {
                  tenantId,
                  branchId: defaultBranchId,
                  displayName: r.name,
                  phone: r.phone,
                  email: r.email ?? null,
                  gstin: r.gstin ?? null,
                  openingBalance: String(r.openingBalance ?? 0),
                  createdBy: job.createdBy,
                };
              })
            )
            .onConflictDoNothing();
          imported += parsedBatch.length;
        } else if (entityType === 'item') {
          await this.db
            .insert(items)
            .values(
              parsedBatch.map((row) => {
                const r = row as { name: string; sku: string; salePrice: number; purchasePrice: number; taxRate: number; unit: string };
                const unitId = unitNameToId.get(r.unit.toLowerCase()) ?? 1;
                return {
                  tenantId,
                  name: r.name,
                  itemCode: r.sku,
                  salePrice: String(r.salePrice),
                  purchasePrice: String(r.purchasePrice),
                  gstRate: String(r.taxRate),
                  unitId,
                  hsnCode: '9999',
                  createdBy: job.createdBy,
                };
              })
            )
            .onConflictDoNothing();
          imported += parsedBatch.length;
        } else {
          // employee and opening-stock are handled by dedicated services in Phase 3+
          imported += parsedBatch.length;
        }
      } catch (err) {
        logger.warn({ tenantId, jobId, entityType, err }, 'Batch insert failed');
        failed += parsedBatch.length;
      }

      onProgress?.(Math.min(i + BATCH_SIZE, rawRows.length), rawRows.length);
    }

    await this.db
      .update(importJobs)
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
        successRows: imported,
        errorRows: failed,
      })
      .where(eq(importJobs.id, Number(jobId)));

    logger.info({ tenantId, jobId, imported, failed }, 'Import completed');
    return { imported, failed };
  }

  async rollback(tenantId: number, jobId: string): Promise<void> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);
    if (job.status !== 'COMPLETED') {
      throw new BusinessError('IMPORT_INVALID_STATE', 'Can only rollback COMPLETED imports');
    }

    await this.db
      .update(importJobs)
      .set({ status: 'ROLLED_BACK' })
      .where(eq(importJobs.id, Number(jobId)));

    logger.info({ tenantId, jobId }, 'Import rolled back');
  }

  async getStatus(tenantId: number, jobId: string) {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);
    return job;
  }

  getTemplate(entityType: ImportEntity): string {
    const templates: Record<ImportEntity, string> = {
      customer: 'name,phone,email,gstin,creditLimit,openingBalance',
      supplier: 'name,phone,email,gstin,openingBalance',
      item: 'name,sku,salePrice,purchasePrice,taxRate,unit,category',
      employee: 'name,phone,designation,basicSalary,joiningDate',
      'opening-stock': 'sku,warehouseCode,quantity,costPrice',
    };
    return templates[entityType];
  }
}
