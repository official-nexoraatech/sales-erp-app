/* global Buffer */
import { eq, and } from 'drizzle-orm';
import { documentAttachments } from '@erp/db';
import { NotFoundError } from '@erp/types';
import type { TenantScopedDatabase } from './database.js';
import type { StorageClient } from './storage.js';

export interface UploadAttachmentInput {
  entityType: string;
  entityId: number;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  fileSize: number;
  uploadedBy: number;
}

// PlatformAttachments — tenant-scoped document attachment CRUD, backed by
// document_attachments (metadata) + StorageClient (object bytes in S3/MinIO).
export class PlatformAttachments {
  constructor(
    private readonly db: TenantScopedDatabase,
    private readonly storage: StorageClient
  ) {}

  async upload(input: UploadAttachmentInput): Promise<typeof documentAttachments.$inferSelect> {
    const objectKey = await this.storage.uploadFile(
      this.db.tenantId,
      input.entityType.toLowerCase(),
      input.fileName,
      input.buffer,
      input.mimeType
    );

    const [row] = await this.db.raw
      .insert(documentAttachments)
      .values({
        tenantId: this.db.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.fileName,
        objectKey,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy,
      })
      .returning();

    if (!row) throw new Error('Attachment insert returned no rows');
    return row;
  }

  async list(entityType: string, entityId: number): Promise<Array<typeof documentAttachments.$inferSelect>> {
    return this.db.raw
      .select()
      .from(documentAttachments)
      .where(
        and(
          eq(documentAttachments.tenantId, this.db.tenantId),
          eq(documentAttachments.entityType, entityType),
          eq(documentAttachments.entityId, entityId)
        )
      );
  }

  // Exposes findOwned() publicly so callers that gate multiple parent entity types per
  // permission (e.g. purchase-service's PURCHASE_ORDER/GRN attachments) can look up which
  // parent type a given attachment belongs to *before* deciding which permission to check —
  // getDownloadUrl()/delete() only return url/fileName/void, never the row itself.
  async get(attachmentId: number): Promise<typeof documentAttachments.$inferSelect> {
    return this.findOwned(attachmentId);
  }

  async getDownloadUrl(attachmentId: number): Promise<{ url: string; fileName: string }> {
    const row = await this.findOwned(attachmentId);
    const url = await this.storage.getSignedUrl(row.objectKey);
    return { url, fileName: row.fileName };
  }

  async delete(attachmentId: number): Promise<void> {
    const row = await this.findOwned(attachmentId);
    await this.storage.deleteFile(row.objectKey);
    await this.db.raw
      .delete(documentAttachments)
      .where(and(eq(documentAttachments.id, attachmentId), eq(documentAttachments.tenantId, this.db.tenantId)));
  }

  private async findOwned(attachmentId: number): Promise<typeof documentAttachments.$inferSelect> {
    const [row] = await this.db.raw
      .select()
      .from(documentAttachments)
      .where(and(eq(documentAttachments.id, attachmentId), eq(documentAttachments.tenantId, this.db.tenantId)));

    if (!row) throw new NotFoundError('Attachment', attachmentId);
    return row;
  }
}
