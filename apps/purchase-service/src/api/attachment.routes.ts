/* global crypto */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlatformContext, PlatformContextFactory, PlatformAttachments } from '@erp/sdk';
import { checkPermission, getBranchScope } from '@erp/sdk';
import { purchaseOrders, grns, suppliers, type ErpDatabase } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { PERMISSIONS, type Permission } from '@erp/types';
import { ValidationError, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
// SUPPLIER added (purchase audit 2026-07-21): supplier records had no way to attach documents
// (registration certificates, agreements, etc) at all — the generic attachment infra already
// exists here for PO/GRN, so the supplier entity type reuses it rather than duplicating file
// storage plumbing into sales-service (which owns the suppliers table but not this endpoint).
const ALLOWED_ENTITY_TYPES = new Set(['PURCHASE_ORDER', 'GRN', 'SUPPLIER']);

// A single attachment's visibility/mutability depends on which parent record it belongs to —
// PURCHASE_ORDER attachments are gated by the PO permissions, GRN attachments by the GRN ones
// (GRN_UPDATE added specifically for this; previously every GRN attachment route was gated on
// PO_UPDATE/PO_VIEW, meaning GRN_VIEW/GRN_CREATE holders without PO permissions couldn't manage
// their own GRN attachments at all, and PO holders could manage GRN attachments without any
// GRN permission).
const VIEW_PERMISSION: Record<string, Permission> = {
  PURCHASE_ORDER: PERMISSIONS.PO_VIEW,
  GRN: PERMISSIONS.GRN_VIEW,
  SUPPLIER: PERMISSIONS.SUPPLIER_VIEW,
};
const WRITE_PERMISSION: Record<string, Permission> = {
  PURCHASE_ORDER: PERMISSIONS.PO_UPDATE,
  GRN: PERMISSIONS.GRN_UPDATE,
  SUPPLIER: PERMISSIONS.SUPPLIER_EDIT,
};

function getAttachments(ctx: PlatformContext): PlatformAttachments {
  if (!ctx.files) throw new Error('Storage is not configured for this service');
  return ctx.files;
}

// Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): attachments are polymorphic
// (entityType + entityId), so branch-scoping has to resolve through whichever parent table the
// attachment belongs to rather than a column on the attachment row itself.
async function resolveEntityBranchId(
  ctx: { db: { raw: ErpDatabase } },
  entityType: string,
  entityId: number,
  tenantId: number
): Promise<number | null> {
  if (entityType === 'PURCHASE_ORDER') {
    const [row] = await ctx.db.raw
      .select({ branchId: purchaseOrders.branchId })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, entityId), eq(purchaseOrders.tenantId, tenantId)));
    return row?.branchId ?? null;
  }
  if (entityType === 'GRN') {
    const [row] = await ctx.db.raw
      .select({ branchId: grns.branchId })
      .from(grns)
      .where(and(eq(grns.id, entityId), eq(grns.tenantId, tenantId)));
    return row?.branchId ?? null;
  }
  if (entityType === 'SUPPLIER') {
    const [row] = await ctx.db.raw
      .select({ branchId: suppliers.branchId })
      .from(suppliers)
      .where(and(eq(suppliers.id, entityId), eq(suppliers.tenantId, tenantId)));
    return row?.branchId ?? null;
  }
  return null;
}

async function assertAttachmentEntityInScope(
  ctx: { db: { raw: ErpDatabase } },
  entityType: string,
  entityId: number,
  tenantId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const branchScope = getBranchScope(auth);
  if (branchScope === 'all') return;
  const branchId = await resolveEntityBranchId(ctx, entityType, entityId, tenantId);
  if (branchId !== null && !branchScope.includes(branchId)) {
    throw new ERPError(
      'ATTACHMENT_OUT_OF_SCOPE',
      'Attachment belongs to a record outside your assigned branch(es)',
      403
    );
  }
}

// checkPermission is a pure function (auth, permission) => 'ok' | 'forbidden' | 'unauthenticated'
// — used directly rather than invoking requirePermission(...) as a preHandler, since the
// permission to check here depends on a value (entityType) that's only known partway through
// the handler (after reading the multipart field, the query string, or looking up the row).
function assertPermission(
  auth: { permissions: string[] } | undefined,
  permission: Permission,
  reply: FastifyReply
): boolean {
  const result = checkPermission(auth, permission);
  if (result === 'unauthenticated') {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
    return false;
  }
  if (result === 'forbidden') {
    reply
      .code(403)
      .send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    return false;
  }
  return true;
}

export async function attachmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // No static preHandler here — entityType (and so the required permission) is only known
  // once the multipart fields are read, inside the handler.
  fastify.post('/attachments', {
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });

      const file = await req.file();
      if (!file) throw new ValidationError('No file uploaded');

      const entityType = (file.fields['entityType'] as { value?: string } | undefined)?.value;
      const entityIdRaw = (file.fields['entityId'] as { value?: string } | undefined)?.value;
      if (!entityType || !ALLOWED_ENTITY_TYPES.has(entityType) || !entityIdRaw) {
        throw new ValidationError(
          'entityType must be PURCHASE_ORDER, GRN, or SUPPLIER and entityId is required'
        );
      }
      if (!assertPermission(req.auth, WRITE_PERMISSION[entityType]!, reply)) return;
      const entityId = parseInt(entityIdRaw, 10);
      await assertAttachmentEntityInScope(ctx, entityType, entityId, req.auth.tenantId, req.auth);

      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError(`Unsupported file type: ${file.mimetype}`);
      }

      const buffer = await file.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File exceeds the 10MB size limit');
      }

      const attachments = getAttachments(ctx);
      const row = await attachments.upload({
        entityType,
        entityId,
        fileName: file.filename,
        buffer,
        mimeType: file.mimetype,
        fileSize: buffer.length,
        uploadedBy: req.auth.userId,
      });

      await ctx.events.publish(
        'attachment',
        row.id,
        'ATTACHMENT_UPLOADED',
        row as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: row });
    },
  });

  // entityType is a query param here, so the permission is known before touching the DB.
  fastify.get('/attachments', {
    handler: async (req, reply) => {
      const q = req.query as { entityType?: string; entityId?: string };
      if (!q.entityType || !q.entityId)
        throw new ValidationError('entityType and entityId are required');
      if (!ALLOWED_ENTITY_TYPES.has(q.entityType))
        throw new ValidationError('entityType must be PURCHASE_ORDER, GRN, or SUPPLIER');
      if (!assertPermission(req.auth, VIEW_PERMISSION[q.entityType]!, reply)) return;

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const entityId = parseInt(q.entityId, 10);
      await assertAttachmentEntityInScope(ctx, q.entityType, entityId, req.auth.tenantId, req.auth);
      const attachments = getAttachments(ctx);
      const rows = await attachments.list(q.entityType, entityId);
      return reply.send({ data: rows });
    },
  });

  // entityType isn't known until the attachment row itself is looked up — attachments.get()
  // (tenant-scoped) fetches it first so the right permission can be checked before generating
  // a signed download URL.
  fastify.get('/attachments/:id/download', {
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const attachments = getAttachments(ctx);

      const row = await attachments.get(parseInt(id, 10));
      if (
        !assertPermission(req.auth, VIEW_PERMISSION[row.entityType] ?? PERMISSIONS.PO_VIEW, reply)
      )
        return;
      await assertAttachmentEntityInScope(
        ctx,
        row.entityType,
        row.entityId,
        req.auth.tenantId,
        req.auth
      );

      const { url } = await attachments.getDownloadUrl(parseInt(id, 10));
      return reply.code(302).redirect(url);
    },
  });

  // Same as download — look up the row first to learn its entityType before deleting it.
  fastify.delete('/attachments/:id', {
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const attachments = getAttachments(ctx);

      const row = await attachments.get(parseInt(id, 10));
      if (
        !assertPermission(
          req.auth,
          WRITE_PERMISSION[row.entityType] ?? PERMISSIONS.PO_UPDATE,
          reply
        )
      )
        return;
      await assertAttachmentEntityInScope(
        ctx,
        row.entityType,
        row.entityId,
        req.auth.tenantId,
        req.auth
      );

      await attachments.delete(parseInt(id, 10));
      await ctx.events.publish('attachment', parseInt(id, 10), 'ATTACHMENT_DELETED', {
        id: parseInt(id, 10),
      });
      return reply.code(204).send();
    },
  });
}
