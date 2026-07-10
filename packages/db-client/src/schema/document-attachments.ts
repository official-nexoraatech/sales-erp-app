import {
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Document Attachments (invoices, POs, GRNs — object stored in S3/MinIO) ─
export const documentAttachments = pgTable(
  'document_attachments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: integer('entity_id').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    objectKey: varchar('object_key', { length: 500 }).notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    uploadedBy: integer('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_document_attachments_entity').on(t.tenantId, t.entityType, t.entityId),
  ]
);

export type DocumentAttachment = typeof documentAttachments.$inferSelect;
export type NewDocumentAttachment = typeof documentAttachments.$inferInsert;
