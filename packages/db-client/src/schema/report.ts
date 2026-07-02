import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Number Series Configuration ──────────────────────────────────────────
export const numberSeriesConfig = pgTable(
  'number_series_config',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id'),
    seriesType: varchar('series_type', { length: 50 }).notNull(),
    prefix: varchar('prefix', { length: 20 }).notNull().default(''),
    formatTemplate: varchar('format_template', { length: 100 }).notNull(),
    sequenceWidth: integer('sequence_width').notNull().default(5),
    currentSeq: integer('current_seq').notNull().default(0),
    financialYear: varchar('financial_year', { length: 10 }).notNull(),
    lastResetAt: timestamp('last_reset_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('num_series_unique').on(t.tenantId, t.seriesType, t.branchId, t.financialYear),
    index('idx_num_series_tenant_type').on(t.tenantId, t.seriesType, t.financialYear),
  ]
);

// ─── Generated Documents (PDF archive) ────────────────────────────────────
export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    documentType: varchar('document_type', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    entityId: integer('entity_id').notNull(),
    s3Key: text('s3_key').notNull(),
    fileName: varchar('file_name', { length: 300 }).notNull(),
    fileSizeBytes: integer('file_size_bytes'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('GENERATING')
      .$type<'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED'>(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    requestedBy: integer('requested_by').notNull(),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_gen_docs_entity').on(t.entityType, t.entityId, t.tenantId),
    index('idx_gen_docs_tenant_type').on(t.tenantId, t.documentType, t.status),
  ]
);

// ─── Report Schedules ──────────────────────────────────────────────────────
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    reportSlug: varchar('report_slug', { length: 100 }).notNull(),
    params: jsonb('params').notNull().default({}),
    format: varchar('format', { length: 10 }).notNull().default('PDF').$type<'PDF' | 'EXCEL' | 'CSV'>(),
    cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
    recipients: jsonb('recipients').notNull().default([]),
    active: integer('active').notNull().default(1),
    unsubscribeToken: varchar('unsubscribe_token', { length: 64 }).notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_report_schedules_tenant').on(t.tenantId, t.active),
  ]
);

// ─── Report Run History ─────────────────────────────────────────────────────
export const reportRunHistory = pgTable(
  'report_run_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    scheduleId: integer('schedule_id'),
    reportSlug: varchar('report_slug', { length: 100 }).notNull(),
    params: jsonb('params').notNull().default({}),
    format: varchar('format', { length: 10 }).notNull().default('PDF').$type<'PDF' | 'EXCEL' | 'CSV'>(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING').$type<'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    fileUrl: text('file_url'),
    errorMessage: text('error_message'),
    triggeredBy: varchar('triggered_by', { length: 20 }).notNull().default('MANUAL').$type<'MANUAL' | 'SCHEDULED'>(),
    rowCount: integer('row_count'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_report_run_tenant').on(t.tenantId, t.status),
    index('idx_report_run_schedule').on(t.scheduleId),
  ]
);

export type NumberSeriesConfig = typeof numberSeriesConfig.$inferSelect;
export type NewNumberSeriesConfig = typeof numberSeriesConfig.$inferInsert;
export type GeneratedDocument = typeof generatedDocuments.$inferSelect;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type NewReportSchedule = typeof reportSchedules.$inferInsert;
export type ReportRunHistory = typeof reportRunHistory.$inferSelect;
