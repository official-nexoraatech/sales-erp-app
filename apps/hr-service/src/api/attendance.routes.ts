import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { attendance, shifts, employees, biometricDeviceConfigs } from '@erp/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { BiometricPunchNormalizer, DEFAULT_BIOMETRIC_CONFIG, type BiometricColumnMapping, type BiometricDeviceConfigInput } from '../domain/BiometricPunchNormalizer.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const MAX_PUNCH_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_PUNCH_MIME_TYPES = new Set(['text/csv', 'text/plain']);

async function schedulerRequest(
  path: string,
  method: string,
  authHeader: string,
  body?: unknown
): Promise<{ data?: Record<string, unknown>; error?: { message: string } }> {
  const schedulerUrl = process.env['SCHEDULER_SERVICE_URL'] ?? 'http://localhost:3016';
  const res = await fetch(`${schedulerUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json()) as { data?: Record<string, unknown>; error?: { message: string } };
  if (!res.ok) throw new BusinessError('IMPORT_UPLOAD_FAILED', json.error?.message ?? `Scheduler request failed: ${path}`);
  return json;
}

const MarkAttendanceSchema = z.object({
  employeeId: z.number().int().positive(),
  attendanceDate: z.string().max(10),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  source: z.enum(['MANUAL', 'BIOMETRIC']).default('MANUAL'),
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'HOLIDAY', 'WEEKLY_OFF']).default('PRESENT'),
  note: z.string().max(500).optional(),
});

const BulkMarkSchema = z.object({
  attendanceDate: z.string().max(10),
  records: z.array(z.object({
    employeeId: z.number().int().positive(),
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'HOLIDAY', 'WEEKLY_OFF']),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
  })).min(1),
});

const CorrectAttendanceSchema = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'HOLIDAY', 'WEEKLY_OFF']).optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  correctionReason: z.string().min(1).max(500),
});

const ShiftSchema = z.object({
  name: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriodMinutes: z.number().int().min(0).max(120).default(15),
  halfDayHours: z.number().min(0).max(12).default(4),
  standardHours: z.number().min(1).max(24).default(8),
  isDefault: z.boolean().default(false),
});

const AttendanceQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const ReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  departmentId: z.coerce.number().int().positive().optional(),
});

function computeWorkHours(checkIn?: string, checkOut?: string): { workHours: number; overtimeHours: number; isLate: boolean } {
  if (!checkIn || !checkOut) return { workHours: 0, overtimeHours: 0, isLate: false };
  const inTime = new Date(checkIn);
  const outTime = new Date(checkOut);
  const workHours = Math.max(0, (outTime.getTime() - inTime.getTime()) / 3600000);
  const overtimeHours = Math.max(0, workHours - 8);
  return { workHours: Math.round(workHours * 100) / 100, overtimeHours: Math.round(overtimeHours * 100) / 100, isLate: false };
}

export async function attendanceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── Shift management ──────────────────────────────────────────────────────
  fastify.get('/shifts', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.isActive, true)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/shifts', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = ShiftSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    if (body.data.isDefault) {
      await ctx.db.raw.update(shifts).set({ isDefault: false }).where(eq(shifts.tenantId, tenantId));
    }
    const [created] = await ctx.db.raw
      .insert(shifts)
      .values({
        tenantId,
        createdBy: userId,
        ...body.data,
        halfDayHours: String(body.data.halfDayHours),
        standardHours: String(body.data.standardHours),
      } as typeof shifts.$inferInsert)
      .returning();
    if (!created) throw new Error('Shift insert failed');
    return reply.code(201).send({ data: created });
  });

  // ── Mark attendance ───────────────────────────────────────────────────────
  fastify.post('/attendance/mark', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = MarkAttendanceSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    // Verify employee exists
    const [emp] = await ctx.db.raw.select({ id: employees.id, displayName: employees.displayName }).from(employees).where(and(eq(employees.id, body.data.employeeId), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!emp) throw new NotFoundError('Employee', body.data.employeeId);

    const { workHours, overtimeHours } = computeWorkHours(body.data.checkInTime, body.data.checkOutTime);

    const [upserted] = await ctx.db.raw
      .insert(attendance)
      .values({
        tenantId,
        createdBy: userId,
        employeeId: body.data.employeeId,
        attendanceDate: body.data.attendanceDate,
        checkInTime: body.data.checkInTime ? new Date(body.data.checkInTime) : undefined,
        checkOutTime: body.data.checkOutTime ? new Date(body.data.checkOutTime) : undefined,
        source: body.data.source,
        status: body.data.status,
        workHours: String(workHours),
        overtimeHours: String(overtimeHours),
        note: body.data.note,
      } as typeof attendance.$inferInsert)
      .onConflictDoUpdate({
        target: [attendance.tenantId, attendance.employeeId, attendance.attendanceDate],
        set: {
          status: body.data.status,
          checkInTime: body.data.checkInTime ? new Date(body.data.checkInTime) : undefined,
          checkOutTime: body.data.checkOutTime ? new Date(body.data.checkOutTime) : undefined,
          workHours: String(workHours),
          overtimeHours: String(overtimeHours),
          updatedAt: new Date(),
        },
      })
      .returning();

    await ctx.audit.log({ action: 'CREATE', entityType: 'attendance', entityId: upserted?.id ?? 0, metadata: { employeeId: body.data.employeeId, date: body.data.attendanceDate, status: body.data.status } });
    if (upserted) {
      // employeeName is denormalized onto the search index document here — the attendance
      // table itself only stores employeeId, and ENTITY_MAPPINGS['attendance'] needs a name
      // to be searchable/displayable at all (see SearchEngine.ts).
      await ctx.events.publish('attendance', upserted.id, 'ATTENDANCE_MARKED', { ...upserted, employeeName: emp.displayName } as unknown as Record<string, unknown>);
    }
    return reply.code(200).send({ data: upserted });
  });

  fastify.post('/attendance/bulk-mark', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = BulkMarkSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const results: unknown[] = [];
    for (const record of body.data.records) {
      const { workHours, overtimeHours } = computeWorkHours(record.checkInTime, record.checkOutTime);
      const [upserted] = await ctx.db.raw
        .insert(attendance)
        .values({
          tenantId,
          createdBy: userId,
          employeeId: record.employeeId,
          attendanceDate: body.data.attendanceDate,
          status: record.status,
          source: 'MANUAL',
          checkInTime: record.checkInTime ? new Date(record.checkInTime) : undefined,
          checkOutTime: record.checkOutTime ? new Date(record.checkOutTime) : undefined,
          workHours: String(workHours),
          overtimeHours: String(overtimeHours),
        } as typeof attendance.$inferInsert)
        .onConflictDoUpdate({
          target: [attendance.tenantId, attendance.employeeId, attendance.attendanceDate],
          set: { status: record.status, updatedAt: new Date() },
        })
        .returning();
      results.push(upserted);
    }

    return reply.code(200).send({ data: { processed: results.length, records: results } });
  });

  fastify.get<{ Params: { employeeId: string } }>('/attendance/:employeeId', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const employeeId = parseInt(request.params.employeeId, 10);
    const query = AttendanceQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const conditions = [eq(attendance.tenantId, tenantId), eq(attendance.employeeId, employeeId)];
    if (query.data.month) {
      const [year, month] = query.data.month.split('-').map(Number) as [number, number];
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      conditions.push(gte(attendance.attendanceDate, startDate));
      conditions.push(lte(attendance.attendanceDate, endDate));
    }

    const rows = await ctx.db.raw.select().from(attendance).where(and(...conditions));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.put<{ Params: { id: string } }>('/attendance/:id/correct', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_CORRECT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = CorrectAttendanceSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(attendance).where(and(eq(attendance.id, id), eq(attendance.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('Attendance', id);

    const updates: Partial<typeof attendance.$inferInsert> = {
      correctionReason: body.data.correctionReason,
      correctedBy: userId,
      correctedAt: new Date(),
      updatedAt: new Date(),
    };
    if (body.data.status) updates.status = body.data.status;
    if (body.data.checkInTime) updates.checkInTime = new Date(body.data.checkInTime);
    if (body.data.checkOutTime) updates.checkOutTime = new Date(body.data.checkOutTime);

    const [updated] = await ctx.db.raw.update(attendance).set(updates as unknown as Partial<typeof attendance.$inferInsert>).where(eq(attendance.id, id)).returning();
    await ctx.audit.log({ action: 'UPDATE', entityType: 'attendance', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, metadata: { reason: body.data.correctionReason } });
    if (updated) {
      const [emp] = await ctx.db.raw.select({ displayName: employees.displayName }).from(employees).where(eq(employees.id, updated.employeeId));
      await ctx.events.publish('attendance', updated.id, 'ATTENDANCE_CORRECTED', { ...updated, employeeName: emp?.displayName } as unknown as Record<string, unknown>);
    }
    return reply.code(200).send({ data: updated });
  });

  fastify.post('/attendance/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const file = await request.file();
    if (!file) throw new ValidationError('No file uploaded');
    if (!ALLOWED_PUNCH_MIME_TYPES.has(file.mimetype)) throw new ValidationError(`Unsupported file type: ${file.mimetype}`);
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_PUNCH_FILE_SIZE) throw new ValidationError('File exceeds the 10MB size limit');

    const [configRow] = await ctx.db.raw.select().from(biometricDeviceConfigs).where(eq(biometricDeviceConfigs.tenantId, tenantId));
    const config: BiometricDeviceConfigInput = configRow
      ? { columnMapping: configRow.columnMapping as unknown as BiometricColumnMapping, dateFormat: configRow.dateFormat }
      : DEFAULT_BIOMETRIC_CONFIG;

    const { punches } = BiometricPunchNormalizer.parseRawPunches(buffer.toString('utf-8'), config);
    const grouped = BiometricPunchNormalizer.groupByEmployeeDay(punches);
    if (grouped.length === 0) throw new BusinessError('IMPORT_EMPTY', 'No valid punch rows found in file');

    // Bulk-resolve employeeCode → {id, shiftId} and each referenced shift in two queries,
    // not one per row (a month of 2-shift punches for 100 employees is ~6,000 raw punches).
    const employeeCodes = [...new Set(grouped.map((g) => g.employeeCode))];
    const employeeRows = await ctx.db.raw
      .select({ id: employees.id, employeeCode: employees.employeeCode, shiftId: employees.shiftId })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.employeeCode, employeeCodes)));
    const employeeByCode = new Map(employeeRows.map((e) => [e.employeeCode, e]));

    const shiftIds = [...new Set(employeeRows.map((e) => e.shiftId).filter((id): id is number => id != null))];
    const shiftRows = shiftIds.length > 0
      ? await ctx.db.raw.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), inArray(shifts.id, shiftIds)))
      : [];
    const [defaultShift] = await ctx.db.raw.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.isDefault, true)));
    const shiftById = new Map(shiftRows.map((s) => [s.id, s]));

    const csvRows = grouped.map((g) => {
      const employee = employeeByCode.get(g.employeeCode);
      const shift = (employee?.shiftId ? shiftById.get(employee.shiftId) : undefined) ?? defaultShift;
      const status = BiometricPunchNormalizer.deriveStatus(
        g.checkInTime,
        g.checkOutTime,
        shift ? { startTime: shift.startTime, gracePeriodMinutes: shift.gracePeriodMinutes, halfDayHours: Number(shift.halfDayHours) } : undefined
      );
      const checkInTime = `${g.date}T${g.checkInTime}`;
      const checkOutTime = g.checkOutTime ? `${g.date}T${g.checkOutTime}` : '';
      return `${g.employeeCode},${g.date},${status},${checkInTime},${checkOutTime},BIOMETRIC`;
    });
    const csvData = ['employeeCode,attendanceDate,status,checkInTime,checkOutTime,source', ...csvRows].join('\n');

    // Hand the normalized rows to scheduler-service's generic ImportEngine (entityType
    // 'attendance') instead of writing a second CSV-parse-validate-execute pipeline here.
    // The column names above already match the entity schema 1:1, so the mapping step is
    // a plain identity mapping — there's no interactive column-picking UI for this path.
    const authHeader = request.headers.authorization ?? '';
    const uploadRes = await schedulerRequest('/imports/upload', 'POST', authHeader, { entityType: 'attendance', csvData, fileName: file.filename });
    const jobId = (uploadRes.data as { jobId: string } | undefined)?.jobId;
    if (!jobId) throw new BusinessError('IMPORT_UPLOAD_FAILED', 'Scheduler service did not return a job id');

    const fields = ['employeeCode', 'attendanceDate', 'status', 'checkInTime', 'checkOutTime', 'source'];
    await schedulerRequest(`/imports/${jobId}/map`, 'POST', authHeader, { mappings: fields.map((f) => ({ sourceColumn: f, targetField: f })) });
    await schedulerRequest(`/imports/${jobId}/validate`, 'POST', authHeader);
    const executeRes = await schedulerRequest(`/imports/${jobId}/execute`, 'POST', authHeader);

    await ctx.audit.log({
      action: 'CREATE',
      entityType: 'attendance_import',
      entityId: 0,
      metadata: { jobId, rowCount: grouped.length, dateRange: [grouped[0]?.date, grouped[grouped.length - 1]?.date] },
    });

    return reply.code(202).send({ data: { jobId, ...executeRes.data } });
  });

  fastify.get('/attendance/report', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_REPORT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = ReportQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const [year, month] = query.data.month.split('-').map(Number) as [number, number];
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const rows = await ctx.db.raw.select().from(attendance).where(and(
      eq(attendance.tenantId, tenantId),
      gte(attendance.attendanceDate, startDate),
      lte(attendance.attendanceDate, endDate),
    ));
    return reply.code(200).send({ data: { content: rows, month: query.data.month } });
  });

  fastify.get('/attendance/team-summary', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_REPORT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = ReportQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const [year, month] = query.data.month.split('-').map(Number) as [number, number];
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const rows = await ctx.db.raw.select().from(attendance).where(and(
      eq(attendance.tenantId, tenantId),
      gte(attendance.attendanceDate, startDate),
      lte(attendance.attendanceDate, endDate),
    ));

    // Group by employee
    const summary: Record<number, { presentDays: number; absentDays: number; lopDays: number; lateDays: number }> = {};
    for (const row of rows) {
      if (!summary[row.employeeId]) summary[row.employeeId] = { presentDays: 0, absentDays: 0, lopDays: 0, lateDays: 0 };
      const s = summary[row.employeeId]!;
      if (row.status === 'PRESENT') s.presentDays++;
      if (row.status === 'ABSENT') { s.absentDays++; s.lopDays++; }
      if (row.status === 'LATE') { s.presentDays++; s.lateDays++; }
      if (row.status === 'HALF_DAY') s.presentDays += 0.5;
    }

    return reply.code(200).send({ data: { summary, month: query.data.month } });
  });
}
