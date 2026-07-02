import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { employees, departments, designations } from '@erp/db';
import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { encryptField } from '@erp/utils';
import { requireEnv } from '@erp/config';
import { createHmac } from 'node:crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateEmployeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(10).max(20),
  email: z.string().email().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.string().max(10).optional(),
  aadhaarLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional(),
  bankAccountNo: z.string().max(20).optional(),
  bankName: z.string().max(200).optional(),
  bankIfsc: z.string().max(20).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'DAILY_WAGE', 'TRAINEE', 'TAILOR']).default('FULL_TIME'),
  departmentId: z.number().int().positive().optional(),
  designationId: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
  managerId: z.number().int().positive().optional(),
  shiftId: z.number().int().positive().optional(),
  joiningDate: z.string().max(10),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.extend({
  version: z.number().int().min(0),
});

const ExitEmployeeSchema = z.object({
  exitDate: z.string().max(10),
  exitReason: z.string().min(1).max(1000),
});

const DepartmentSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(30),
  description: z.string().max(2000).optional(),
  managerId: z.number().int().positive().optional(),
});

const DesignationSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(30),
  description: z.string().max(2000).optional(),
});

const ListEmployeeQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  employmentType: z.string().optional(),
  status: z.string().optional(),
});

function generateEmployeeCode(id: number): string {
  return `EMP-${String(id).padStart(5, '0')}`;
}

export async function employeeRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── Departments ──────────────────────────────────────────────────────────
  fastify.get('/departments', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(departments).where(and(eq(departments.tenantId, tenantId), isNull(departments.deletedAt)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/departments', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = DepartmentSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [created] = await ctx.db.raw.insert(departments).values({ tenantId, createdBy: userId, ...body.data } as typeof departments.$inferInsert).returning();
    if (!created) throw new Error('Department insert failed');
    await ctx.audit.log({ action: 'CREATE', entityType: 'department', entityId: created.id, after: created as unknown as Record<string, unknown> });
    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/departments/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = DepartmentSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [existing] = await ctx.db.raw.select().from(departments).where(and(eq(departments.id, id), eq(departments.tenantId, tenantId), isNull(departments.deletedAt)));
    if (!existing) throw new NotFoundError('Department', id);
    const [updated] = await ctx.db.raw.update(departments).set({ ...body.data, updatedAt: new Date() } as unknown as Partial<typeof departments.$inferInsert>).where(eq(departments.id, id)).returning();
    await ctx.audit.log({ action: 'UPDATE', entityType: 'department', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });
    return reply.code(200).send({ data: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/departments/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw.select().from(departments).where(and(eq(departments.id, id), eq(departments.tenantId, tenantId), isNull(departments.deletedAt)));
    if (!existing) throw new NotFoundError('Department', id);
    await ctx.db.raw.update(departments).set({ deletedAt: new Date(), deletedBy: userId, isActive: false }).where(eq(departments.id, id));
    await ctx.audit.log({ action: 'DELETE', entityType: 'department', entityId: id });
    return reply.code(200).send({ data: { message: 'Deleted', id } });
  });

  // ── Designations ─────────────────────────────────────────────────────────
  fastify.get('/designations', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(designations).where(and(eq(designations.tenantId, tenantId), isNull(designations.deletedAt)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/designations', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = DesignationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [created] = await ctx.db.raw.insert(designations).values({ tenantId, createdBy: userId, ...body.data } as typeof designations.$inferInsert).returning();
    if (!created) throw new Error('Designation insert failed');
    await ctx.audit.log({ action: 'CREATE', entityType: 'designation', entityId: created.id, after: created as unknown as Record<string, unknown> });
    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/designations/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = DesignationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [existing] = await ctx.db.raw.select().from(designations).where(and(eq(designations.id, id), eq(designations.tenantId, tenantId), isNull(designations.deletedAt)));
    if (!existing) throw new NotFoundError('Designation', id);
    const [updated] = await ctx.db.raw.update(designations).set({ ...body.data, updatedAt: new Date() } as unknown as Partial<typeof designations.$inferInsert>).where(eq(designations.id, id)).returning();
    await ctx.audit.log({ action: 'UPDATE', entityType: 'designation', entityId: id });
    return reply.code(200).send({ data: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/designations/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw.select().from(designations).where(and(eq(designations.id, id), eq(designations.tenantId, tenantId), isNull(designations.deletedAt)));
    if (!existing) throw new NotFoundError('Designation', id);
    await ctx.db.raw.update(designations).set({ deletedAt: new Date(), deletedBy: userId, isActive: false }).where(eq(designations.id, id));
    await ctx.audit.log({ action: 'DELETE', entityType: 'designation', entityId: id });
    return reply.code(200).send({ data: { message: 'Deleted', id } });
  });

  // ── Employees ─────────────────────────────────────────────────────────────
  fastify.get('/employees', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = ListEmployeeQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));
    const { page, size, search, departmentId, employmentType, status } = query.data;

    const conditions = [eq(employees.tenantId, tenantId), isNull(employees.deletedAt)];
    if (search) conditions.push(or(ilike(employees.displayName, `%${search}%`), ilike(employees.phone, `%${search}%`), ilike(employees.employeeCode, `%${search}%`)) as ReturnType<typeof eq>);
    if (departmentId) conditions.push(eq(employees.departmentId, departmentId));
    if (employmentType) conditions.push(eq(employees.employmentType, employmentType as typeof employees.$inferSelect['employmentType']));
    if (status) conditions.push(eq(employees.status, status as typeof employees.$inferSelect['status']));

    const rows = await ctx.db.raw
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        displayName: employees.displayName,
        phone: employees.phone,
        email: employees.email,
        gender: employees.gender,
        employmentType: employees.employmentType,
        departmentId: employees.departmentId,
        designationId: employees.designationId,
        branchId: employees.branchId,
        joiningDate: employees.joiningDate,
        status: employees.status,
        photoUrl: employees.photoUrl,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(and(...conditions))
      .limit(size)
      .offset(page * size);

    return reply.code(200).send({ data: { content: rows, totalElements: rows.length, page, size } });
  });

  fastify.get<{ Params: { id: string } }>('/employees/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [emp] = await ctx.db.raw
      .select()
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!emp) throw new NotFoundError('Employee', id);

    // Check if caller has PAYROLL_VIEW permission before returning salary
    const hasPayrollView = request.auth.permissions.includes(PERMISSIONS.PAYROLL_VIEW);

    // Never return encrypted salary in GET detail — only metadata
    const result = {
      ...emp,
      panEncrypted: undefined,
      panHash: undefined,
      bankAccountNoEncrypted: undefined,
      bankAccountNoHash: undefined,
      hasSalaryData: hasPayrollView,
    };

    return reply.code(200).send({ data: result });
  });

  fastify.post('/employees', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = CreateEmployeeSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const { pan, bankAccountNo, aadhaarLast4, ...rest } = body.data;
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    let panEncrypted: string | undefined;
    let panHash: string | undefined;
    let bankAccountNoEncrypted: string | undefined;
    let bankAccountNoHash: string | undefined;

    if (pan) {
      panEncrypted = encryptField(pan, encKey);
      panHash = createHmac('sha256', encKey).update(pan).digest('hex');
    }
    if (bankAccountNo) {
      bankAccountNoEncrypted = encryptField(bankAccountNo, encKey);
      bankAccountNoHash = createHmac('sha256', encKey).update(bankAccountNo).digest('hex');
    }

    const displayName = `${rest.firstName} ${rest.lastName}`;

    const [created] = await ctx.db.raw
      .insert(employees)
      .values({
        tenantId,
        createdBy: userId,
        displayName,
        employeeCode: 'EMP-TEMP',
        ...(aadhaarLast4 ? { aadhaarLast4 } : {}),
        ...(panEncrypted ? { panEncrypted, panHash } : {}),
        ...(bankAccountNoEncrypted ? { bankAccountNoEncrypted, bankAccountNoHash } : {}),
        ...rest,
      } as typeof employees.$inferInsert)
      .returning();

    if (!created) throw new Error('Employee insert failed');

    // Update with generated code
    const empCode = generateEmployeeCode(created.id);
    const [final] = await ctx.db.raw
      .update(employees)
      .set({ employeeCode: empCode })
      .where(eq(employees.id, created.id))
      .returning();

    await ctx.events.publish('employee', created.id, 'EMPLOYEE_JOINED', { employeeId: created.id, tenantId, displayName });
    await ctx.audit.log({ action: 'CREATE', entityType: 'employee', entityId: created.id, after: { employeeId: created.id, displayName } });

    return reply.code(201).send({ data: { ...final, panEncrypted: undefined, bankAccountNoEncrypted: undefined } });
  });

  fastify.put<{ Params: { id: string } }>('/employees/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = UpdateEmployeeSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!existing) throw new NotFoundError('Employee', id);

    const { pan, bankAccountNo, version, aadhaarLast4, ...rest } = body.data;
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    const updates: Partial<typeof employees.$inferInsert> = {
      ...rest,
      displayName: `${rest.firstName} ${rest.lastName}`,
      updatedAt: new Date(),
      version: existing.version + 1,
      ...(aadhaarLast4 ? { aadhaarLast4 } : {}),
    };

    if (pan) {
      updates.panEncrypted = encryptField(pan, encKey);
      updates.panHash = createHmac('sha256', encKey).update(pan).digest('hex');
    }
    if (bankAccountNo) {
      updates.bankAccountNoEncrypted = encryptField(bankAccountNo, encKey);
      updates.bankAccountNoHash = createHmac('sha256', encKey).update(bankAccountNo).digest('hex');
    }

    const result = await ctx.db.raw
      .update(employees)
      .set(updates as unknown as Partial<typeof employees.$inferInsert>)
      .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId), eq(employees.version, version)))
      .returning();

    if (!result[0]) throw new BusinessError('OPTIMISTIC_LOCK_CONFLICT', 'Employee was modified concurrently. Please refresh and retry.');

    await ctx.audit.log({ action: 'UPDATE', entityType: 'employee', entityId: id });
    return reply.code(200).send({ data: { ...result[0], panEncrypted: undefined, bankAccountNoEncrypted: undefined } });
  });

  fastify.post<{ Params: { id: string } }>('/employees/:id/exit', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = ExitEmployeeSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!existing) throw new NotFoundError('Employee', id);

    await ctx.db.raw.update(employees).set({ exitDate: body.data.exitDate, exitReason: body.data.exitReason, status: 'EXITED', isActive: false, updatedAt: new Date() }).where(eq(employees.id, id));

    await ctx.events.publish('employee', id, 'EMPLOYEE_EXITED', { employeeId: id, tenantId, ...body.data });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'employee', entityId: id, metadata: { action: 'EXIT', ...body.data } });

    return reply.code(200).send({ data: { message: 'Employee exit recorded', employeeId: id } });
  });

  fastify.post<{ Params: { id: string } }>('/employees/:id/photo/upload', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('Employee', id);
    // Return a pre-signed URL placeholder; real S3 wiring via MinIO in production
    const uploadUrl = `/uploads/employees/${id}/photo`;
    return reply.code(200).send({ data: { uploadUrl, employeeId: id } });
  });

  fastify.post<{ Params: { id: string } }>('/employees/:id/documents/upload', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('Employee', id);
    const uploadUrl = `/uploads/employees/${id}/documents`;
    return reply.code(200).send({ data: { uploadUrl, employeeId: id } });
  });

  fastify.post('/employees/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_IMPORT)] }, async (_request, reply) => {
    return reply.code(202).send({ data: { message: 'Import queued', status: 'QUEUED' } });
  });
}
