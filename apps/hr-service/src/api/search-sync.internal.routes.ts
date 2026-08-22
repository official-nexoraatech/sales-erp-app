/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { withTenantConnection } from '@erp/sdk';
import {
  employees,
  departments,
  designations,
  attendance,
  payrollRuns,
  leaveApplications,
} from '@erp/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

interface SearchSyncDoc {
  id: string;
  doc: Record<string, unknown>;
}

interface SearchSyncQuery {
  tenantId: string;
  page?: string;
  size?: string;
  modifiedSince?: string;
}

// GET /internal/search-sync/:entity — see tenant-service's copy of this file for the full
// rationale (Phase 4 backfill/incremental-sync jobs). NOT protected by JWT — internal-only,
// guarded by x-internal-key.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No req.auth (internal-key-guarded,
// caveat 5b) — tenantId comes from the query string, so this uses withTenantConnection directly.
export async function searchSyncInternalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Params: { entity: string }; Querystring: SearchSyncQuery }>(
    '/internal/search-sync/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const { entity } = request.params;
      if (!['employee', 'attendance', 'payroll_run', 'leave_application'].includes(entity)) {
        return reply
          .code(422)
          .send({
            error: { code: 'INVALID_ENTITY', message: `hr-service does not own entity: ${entity}` },
          });
      }

      const tenantId = parseInt(request.query.tenantId, 10);
      const page = parseInt(request.query.page ?? '0', 10);
      const size = Math.min(parseInt(request.query.size ?? '500', 10), 500);
      const offset = page * size;
      const modifiedSince = request.query.modifiedSince
        ? new Date(request.query.modifiedSince)
        : undefined;

      const content: SearchSyncDoc[] = await withTenantConnection(
        ctxFactory.rawDb,
        tenantId,
        async (db) => {
          if (entity === 'employee') {
            const conditions = [eq(employees.tenantId, tenantId), isNull(employees.deletedAt)];
            if (modifiedSince) conditions.push(gte(employees.updatedAt, modifiedSince));
            const rows = await db
              .select({
                id: employees.id,
                displayName: employees.displayName,
                employeeCode: employees.employeeCode,
                department: departments.name,
                designation: designations.name,
              })
              .from(employees)
              .leftJoin(departments, eq(departments.id, employees.departmentId))
              .leftJoin(designations, eq(designations.id, employees.designationId))
              .where(and(...conditions))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({
              id: String(r.id),
              doc: {
                name: r.displayName,
                employeeCode: r.employeeCode,
                designation: r.designation,
                department: r.department,
                tenantId,
              },
            }));
          } else if (entity === 'attendance') {
            const conditions = [eq(attendance.tenantId, tenantId)];
            if (modifiedSince) conditions.push(gte(attendance.updatedAt, modifiedSince));
            const rows = await db
              .select({
                id: attendance.id,
                employeeName: employees.displayName,
                attendanceDate: attendance.attendanceDate,
              })
              .from(attendance)
              .innerJoin(employees, eq(employees.id, attendance.employeeId))
              .where(and(...conditions))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({
              id: String(r.id),
              doc: { employeeName: r.employeeName, attendanceDate: r.attendanceDate, tenantId },
            }));
          } else if (entity === 'payroll_run') {
            const conditions = [eq(payrollRuns.tenantId, tenantId)];
            if (modifiedSince) conditions.push(gte(payrollRuns.updatedAt, modifiedSince));
            const rows = await db
              .select()
              .from(payrollRuns)
              .where(and(...conditions))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({
              id: String(r.id),
              doc: {
                periodMonth: r.periodMonth,
                periodYear: r.periodYear,
                status: r.status,
                tenantId,
              },
            }));
          } else {
            // entity === 'leave_application'
            const conditions = [eq(leaveApplications.tenantId, tenantId)];
            if (modifiedSince) conditions.push(gte(leaveApplications.updatedAt, modifiedSince));
            const rows = await db
              .select({
                id: leaveApplications.id,
                employeeName: employees.displayName,
                startDate: leaveApplications.startDate,
                endDate: leaveApplications.endDate,
                status: leaveApplications.status,
              })
              .from(leaveApplications)
              .innerJoin(employees, eq(employees.id, leaveApplications.employeeId))
              .where(and(...conditions))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({
              id: String(r.id),
              doc: {
                employeeName: r.employeeName,
                startDate: r.startDate,
                endDate: r.endDate,
                status: r.status,
                tenantId,
              },
            }));
          }
        }
      );

      return reply
        .code(200)
        .send({
          data: { content, totalElements: content.length, hasMore: content.length === size },
        });
    }
  );
}
