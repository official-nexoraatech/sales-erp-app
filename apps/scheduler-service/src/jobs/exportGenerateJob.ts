/* global Buffer */
import { eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { exportJobs } from '@erp/db';
import type { StorageClient } from '@erp/sdk';
import { withTenantConnection } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import type { JobRegistry } from '../JobRegistry.js';
import { ExportEngine, type ExportEntity } from '../domain/ExportEngine.js';
import { ExportFormatter } from '../domain/ExportFormatter.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

export const EXPORT_GENERATE_JOB = 'export-generate';

interface ExportJobData {
  jobId: number;
  entityType: ExportEntity;
  format: 'CSV' | 'XLSX';
  filters?: Record<string, unknown>;
}

export function registerExportGenerateJob(
  registry: JobRegistry,
  db: ErpDatabase,
  storage: StorageClient
): void {
  const formatter = new ExportFormatter();

  registry.register(
    EXPORT_GENERATE_JOB,
    {
      cron: 'manual-only',
      description:
        'Generates a real CSV/XLSX file for a requested entity export and uploads it to MinIO',
      tenantScoped: true,
      manualOnly: true,
    },
    async (job, tenantId) => {
      const data = job.data as ExportJobData;
      if (tenantId === undefined) {
        logger.warn({ jobId: data.jobId }, 'Export job triggered without a tenantId — skipping');
        return;
      }

      const start = Date.now();
      try {
        // RLS-readiness follow-up (2026-08-22): single-tenant per invocation. ExportEngine used
        // to be built once at registration time against the shared pooled db (same
        // route-registration-time-singleton gap as ImportEngine/NotificationEngine elsewhere in
        // this rollout) — now built fresh per invocation from the scoped connection. The MinIO
        // upload/signed-url calls are real external I/O, kept outside any transaction (caveat
        // 4g); the query read and each status-update write get their own short wrap.
        const { columns, rows, totalRows } = await withTenantConnection(db, tenantId, (scopedDb) =>
          new ExportEngine(scopedDb).query(tenantId, data.entityType, data.filters)
        );
        const buffer =
          data.format === 'XLSX'
            ? formatter.toExcel(data.entityType, columns, rows)
            : Buffer.from(formatter.toCSV(columns, rows), 'utf-8');

        const fileName = formatter.getFileName(data.entityType, data.format);
        const mimeType = formatter.getContentType(data.format);
        const objectKey = await storage.uploadFile(tenantId, 'exports', fileName, buffer, mimeType);
        const signedUrl = await storage.getSignedUrl(objectKey, 86400);

        await withTenantConnection(db, tenantId, (scopedDb) =>
          scopedDb
            .update(exportJobs)
            .set({
              status: 'READY',
              s3Key: objectKey,
              signedUrl,
              totalRows,
              completedAt: new Date(),
            })
            .where(eq(exportJobs.id, data.jobId))
        );

        logger.info(
          {
            tenantId,
            jobId: data.jobId,
            entityType: data.entityType,
            totalRows,
            durationMs: Date.now() - start,
          },
          'Export generated'
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await withTenantConnection(db, tenantId, (scopedDb) =>
          scopedDb
            .update(exportJobs)
            .set({ status: 'FAILED', errorMessage })
            .where(eq(exportJobs.id, data.jobId))
        );
        throw err;
      }
    }
  );
}
