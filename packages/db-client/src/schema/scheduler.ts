import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Job History (last 30 runs per job type per tenant) ───────────────────
export const jobHistory = pgTable(
  'job_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    jobName: varchar('job_name', { length: 200 }).notNull(),
    cronExpression: varchar('cron_expression', { length: 100 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('RUNNING')
      .$type<'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'>(),
    triggeredBy: varchar('triggered_by', { length: 20 })
      .notNull()
      .default('CRON')
      .$type<'CRON' | 'MANUAL'>(),
    triggeredByUserId: integer('triggered_by_user_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    result: jsonb('result').default({}),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull().default(0),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_job_history_tenant_job').on(t.tenantId, t.jobName, t.startedAt),
    index('idx_job_history_status').on(t.status, t.startedAt),
  ]
);

// ─── Import Jobs ──────────────────────────────────────────────────────────
export const importJobs = pgTable(
  'import_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('UPLOADED')
      .$type<'UPLOADED' | 'MAPPED' | 'VALIDATING' | 'VALIDATED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK'>(),
    s3Key: text('s3_key').notNull(),
    originalFileName: varchar('original_file_name', { length: 300 }).notNull(),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    successRows: integer('success_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    columnMapping: jsonb('column_mapping').$type<Record<string, string>>().default({}),
    validationErrors: jsonb('validation_errors').$type<ValidationError[]>().default([]),
    errorReportS3Key: text('error_report_s3_key'),
    rollbackData: jsonb('rollback_data').default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    requestedBy: integer('requested_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_import_jobs_tenant').on(t.tenantId, t.status, t.createdAt),
    index('idx_import_jobs_requested_by').on(t.requestedBy, t.tenantId),
  ]
);

// ─── Export Jobs ──────────────────────────────────────────────────────────
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    format: varchar('format', { length: 10 }).notNull().default('XLSX').$type<'XLSX' | 'CSV' | 'PDF'>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED'>(),
    filters: jsonb('filters').default({}),
    s3Key: text('s3_key'),
    signedUrl: text('signed_url'),
    signedUrlExpiresAt: timestamp('signed_url_expires_at', { withTimezone: true }),
    totalRows: integer('total_rows').notNull().default(0),
    errorMessage: text('error_message'),
    requestedBy: integer('requested_by').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_export_jobs_tenant').on(t.tenantId, t.status, t.createdAt),
    index('idx_export_jobs_requested_by').on(t.requestedBy, t.tenantId),
  ]
);

// ─── Scheduled Job Configs (paused/active state) ──────────────────────────
export const scheduledJobConfigs = pgTable(
  'scheduled_job_configs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    jobName: varchar('job_name', { length: 200 }).notNull(),
    cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
    isPaused: boolean('is_paused').notNull().default(false),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedBy: integer('paused_by'),
    config: jsonb('config').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull().default(0),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('sched_job_config_unique').on(t.tenantId, t.jobName),
    index('idx_sched_job_config_tenant').on(t.tenantId),
  ]
);

export interface ValidationError {
  row: number;
  column: string;
  value: unknown;
  message: string;
}

export type JobHistoryEntry = typeof jobHistory.$inferSelect;
export type NewJobHistoryEntry = typeof jobHistory.$inferInsert;
export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
export type ExportJob = typeof exportJobs.$inferSelect;
