/* global crypto */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { campaigns } from '@erp/db';
import type { PlatformContext, PlatformContextFactory, PlatformAttachments } from '@erp/sdk';
import { checkPermission } from '@erp/sdk';
import { PERMISSIONS, type Permission } from '@erp/types';
import { ValidationError, NotFoundError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { validateMediaForChannel } from '../domain/CampaignService.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ALLOWED_ENTITY_TYPES = new Set(['INVOICE', 'CAMPAIGN']);

// CP-2: generalized from a single-entity-type (INVOICE-only) route to also carry campaign media
// attachments — reuses the same PlatformAttachments/document_attachments storage every other
// service's attachment route already uses, rather than introducing a parallel campaign-only
// media table. Each entity type maps to its own view/write permission, mirroring the pattern
// already established in purchase-service's attachment.routes.ts.
const VIEW_PERMISSION: Record<string, Permission> = {
  INVOICE: PERMISSIONS.INVOICE_VIEW,
  CAMPAIGN: PERMISSIONS.CRM_VIEW,
};
const WRITE_PERMISSION: Record<string, Permission> = {
  INVOICE: PERMISSIONS.INVOICE_UPDATE,
  CAMPAIGN: PERMISSIONS.CRM_CAMPAIGN_CREATE,
};

function getAttachments(ctx: PlatformContext): PlatformAttachments {
  if (!ctx.files) throw new Error('Storage is not configured for this service');
  return ctx.files;
}

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
          'entityType must be INVOICE or CAMPAIGN and entityId is required'
        );
      }
      if (!assertPermission(req.auth, WRITE_PERMISSION[entityType]!, reply)) return;
      const entityId = parseInt(entityIdRaw, 10);

      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError(`Unsupported file type: ${file.mimetype}`);
      }

      const buffer = await file.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File exceeds the 10MB size limit');
      }

      if (entityType === 'CAMPAIGN') {
        const [campaign] = await ctx.db.raw
          .select({ channel: campaigns.channel })
          .from(campaigns)
          .where(and(eq(campaigns.id, entityId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
        if (!campaign) throw new NotFoundError('Campaign', entityId);
        validateMediaForChannel(campaign.channel, file.mimetype, buffer.length);
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

  fastify.get('/attachments', {
    handler: async (req, reply) => {
      const q = req.query as { entityType?: string; entityId?: string };
      if (!q.entityType || !q.entityId)
        throw new ValidationError('entityType and entityId are required');
      if (!ALLOWED_ENTITY_TYPES.has(q.entityType))
        throw new ValidationError('entityType must be INVOICE or CAMPAIGN');
      if (!assertPermission(req.auth, VIEW_PERMISSION[q.entityType]!, reply)) return;

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const attachments = getAttachments(ctx);
      const rows = await attachments.list(q.entityType, parseInt(q.entityId, 10));
      return reply.send({ data: rows });
    },
  });

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
        !assertPermission(
          req.auth,
          VIEW_PERMISSION[row.entityType] ?? PERMISSIONS.INVOICE_VIEW,
          reply
        )
      )
        return;

      const { url } = await attachments.getDownloadUrl(parseInt(id, 10));
      return reply.code(302).redirect(url);
    },
  });

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
          WRITE_PERMISSION[row.entityType] ?? PERMISSIONS.INVOICE_UPDATE,
          reply
        )
      )
        return;

      await attachments.delete(parseInt(id, 10));
      await ctx.events.publish('attachment', parseInt(id, 10), 'ATTACHMENT_DELETED', {
        id: parseInt(id, 10),
      });
      return reply.code(204).send();
    },
  });
}
