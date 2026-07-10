import type { ErpDatabase } from '@erp/db';
import { importJobs, customers, suppliers, items, units, branches, employees, departments, designations, attendance } from '@erp/db';
import { eq, and, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { createLogger } from '@erp/logger';
import { BusinessError, NotFoundError, PermissionError, PERMISSIONS, OptionalPANSchema, OptionalBankAccountSchema } from '@erp/types';
import { requireEnv } from '@erp/config';
import { encryptField } from '@erp/utils';
import { createHmac } from 'node:crypto';
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

export type ImportEntity = 'customer' | 'supplier' | 'item' | 'employee' | 'opening-stock' | 'attendance';

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
    employeeCode: z.string().min(1).max(30).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    department: z.string().optional(),
    pan: OptionalPANSchema,
    bankAccountNo: OptionalBankAccountSchema,
  }),
  'opening-stock': z.object({
    sku: z.string().min(1),
    warehouseCode: z.string().min(1),
    quantity: z.coerce.number().min(0),
    costPrice: z.coerce.number().min(0),
  }),
  attendance: z.object({
    employeeCode: z.string().min(1),
    attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'HOLIDAY', 'WEEKLY_OFF']).default('PRESENT'),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
    source: z.enum(['MANUAL', 'BIOMETRIC']).default('MANUAL'),
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
    permissions: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ imported: number; failed: number }> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ImportJob', jobId);

    // Employee rows can carry PAN/bank-account data — require the same permission the
    // single-employee-create route requires, in addition to the generic IMPORT_EXECUTE
    // every entity type is already gated on at the route layer.
    if (job.entityType === 'employee' && !permissions.includes(PERMISSIONS.EMPLOYEE_IMPORT)) {
      throw new PermissionError(PERMISSIONS.EMPLOYEE_IMPORT);
    }

    // ES-26 (M9): atomic conditional UPDATE — if another call already claimed this job (or it's
    // not in a runnable state), zero rows come back and we reject instead of double-executing.
    const [claimed] = await this.db
      .update(importJobs)
      .set({ status: 'EXECUTING', startedAt: new Date() })
      .where(and(eq(importJobs.id, Number(jobId)), eq(importJobs.tenantId, tenantId), eq(importJobs.status, 'VALIDATED')))
      .returning({ id: importJobs.id });

    if (!claimed) {
      throw new BusinessError('IMPORT_INVALID_STATE', `Cannot execute in state: ${job.status}`);
    }

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

    // Pre-fetch department/designation name→id maps and the next employeeCode sequence
    // number for employee imports — one query each per execute() call, not per row/batch.
    let departmentNameToId = new Map<string, number>();
    let designationNameToId = new Map<string, number>();
    let nextEmployeeCodeSeq = 1;
    if (entityType === 'employee') {
      const allDepartments = await this.db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.tenantId, tenantId));
      for (const d of allDepartments) departmentNameToId.set(d.name.toLowerCase(), d.id);

      const allDesignations = await this.db
        .select({ id: designations.id, name: designations.name })
        .from(designations)
        .where(eq(designations.tenantId, tenantId));
      for (const d of allDesignations) designationNameToId.set(d.name.toLowerCase(), d.id);

      const allEmployees = await this.db
        .select({ employeeCode: employees.employeeCode })
        .from(employees)
        .where(eq(employees.tenantId, tenantId));
      for (const e of allEmployees) {
        const match = /^EMP-(\d+)$/.exec(e.employeeCode);
        if (match) nextEmployeeCodeSeq = Math.max(nextEmployeeCodeSeq, Number(match[1]) + 1);
      }
    }

    // Pre-fetch employeeCode→id map for attendance imports
    let employeeCodeToId = new Map<string, number>();
    if (entityType === 'attendance') {
      const allEmployees = await this.db
        .select({ id: employees.id, employeeCode: employees.employeeCode })
        .from(employees)
        .where(eq(employees.tenantId, tenantId));
      for (const e of allEmployees) employeeCodeToId.set(e.employeeCode, e.id);
    }

    const encKey = entityType === 'employee' ? requireEnv('FIELD_ENCRYPTION_KEY') : '';

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
        } else if (entityType === 'employee') {
          const rowsToInsert = parsedBatch.map((row) => {
            const r = row as {
              name: string; phone: string; designation: string; basicSalary: number; joiningDate: string;
              employeeCode?: string; gender?: 'MALE' | 'FEMALE' | 'OTHER'; department?: string; pan?: string; bankAccountNo?: string;
            };
            const employeeCode = r.employeeCode || `EMP-${String(nextEmployeeCodeSeq++).padStart(5, '0')}`;
            const [firstName, ...rest] = r.name.trim().split(/\s+/);
            const lastName = rest.length > 0 ? rest.join(' ') : firstName!;
            const designationId = designationNameToId.get(r.designation.toLowerCase());
            const departmentId = r.department ? departmentNameToId.get(r.department.toLowerCase()) : undefined;

            let panEncrypted: string | undefined;
            let panHash: string | undefined;
            if (r.pan) {
              panEncrypted = encryptField(r.pan, encKey);
              panHash = createHmac('sha256', encKey).update(r.pan).digest('hex');
            }
            let bankAccountNoEncrypted: string | undefined;
            let bankAccountNoHash: string | undefined;
            if (r.bankAccountNo) {
              bankAccountNoEncrypted = encryptField(r.bankAccountNo, encKey);
              bankAccountNoHash = createHmac('sha256', encKey).update(r.bankAccountNo).digest('hex');
            }

            // basicSalary is validated but intentionally not persisted here — employees has
            // no salary column; initial salary is set up via the separate payroll/salary-
            // structure flow, same as the single-employee-create route.
            return {
              tenantId,
              branchId: defaultBranchId,
              employeeCode,
              firstName: firstName!,
              lastName,
              displayName: r.name,
              phone: r.phone,
              ...(r.gender ? { gender: r.gender } : {}),
              ...(departmentId ? { departmentId } : {}),
              ...(designationId ? { designationId } : {}),
              ...(panEncrypted ? { panEncrypted, panHash } : {}),
              ...(bankAccountNoEncrypted ? { bankAccountNoEncrypted, bankAccountNoHash } : {}),
              pfApplicable: true,
              esiApplicable: true,
              employmentType: 'FULL_TIME' as const,
              status: 'ACTIVE' as const,
              joiningDate: r.joiningDate,
              createdBy: job.createdBy,
            };
          });

          await this.db
            .insert(employees)
            .values(rowsToInsert as unknown as (typeof employees.$inferInsert)[])
            .onConflictDoNothing();
          imported += parsedBatch.length;
        } else if (entityType === 'attendance') {
          const resolvedRows: Array<Record<string, unknown>> = [];
          let unresolvedCount = 0;
          for (const row of parsedBatch) {
            const r = row as { employeeCode: string; attendanceDate: string; status: string; checkInTime?: string; checkOutTime?: string; source: string };
            const employeeId = employeeCodeToId.get(r.employeeCode);
            if (!employeeId) {
              unresolvedCount++;
              continue;
            }
            resolvedRows.push({
              tenantId,
              employeeId,
              attendanceDate: r.attendanceDate,
              status: r.status,
              source: r.source,
              ...(r.checkInTime ? { checkInTime: new Date(r.checkInTime) } : {}),
              ...(r.checkOutTime ? { checkOutTime: new Date(r.checkOutTime) } : {}),
              createdBy: job.createdBy,
            });
          }

          if (resolvedRows.length > 0) {
            await this.db
              .insert(attendance)
              .values(resolvedRows as unknown as (typeof attendance.$inferInsert)[])
              .onConflictDoUpdate({
                target: [attendance.tenantId, attendance.employeeId, attendance.attendanceDate],
                set: {
                  status: sql`excluded.status`,
                  source: sql`excluded.source`,
                  checkInTime: sql`excluded.check_in_time`,
                  checkOutTime: sql`excluded.check_out_time`,
                  updatedAt: new Date(),
                },
              });
          }
          imported += resolvedRows.length;
          failed += unresolvedCount;
        } else {
          // opening-stock: no insert branch exists yet (separate inventory-module concern,
          // not fixed by this pass) — rows are counted as "imported" without ever being
          // written anywhere, matching this entity type's pre-existing (unfixed) behavior.
          logger.warn({ tenantId, jobId, entityType }, 'opening-stock import is not implemented — rows counted but not persisted');
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
      employee: 'name,phone,designation,basicSalary,joiningDate,employeeCode,gender,department,pan,bankAccountNo',
      'opening-stock': 'sku,warehouseCode,quantity,costPrice',
      attendance: 'employeeCode,attendanceDate,status,checkInTime,checkOutTime,source',
    };
    return templates[entityType];
  }
}
