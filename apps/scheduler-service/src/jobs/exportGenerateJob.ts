/* global Buffer */
import { eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { exportJobs } from '@erp/db';
import type { StorageClient } from '@erp/sdk';
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

export function registerExportGenerateJob(registry: JobRegistry, db: ErpDatabase, storage: StorageClient): void {
  const engine = new ExportEngine(db);
  const formatter = new ExportFormatter();

  registry.register(
    EXPORT_GENERATE_JOB,
    {
      cron: 'manual-only',
      description: 'Generates a real CSV/XLSX file for a requested entity export and uploads it to MinIO',
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
        const { columns, rows, totalRows } = await engine.query(tenantId, data.entityType, data.filters);
        const buffer =
          data.format === 'XLSX'
            ? formatter.toExcel(data.entityType, columns, rows)
            : Buffer.from(formatter.toCSV(columns, rows), 'utf-8');

        const fileName = formatter.getFileName(data.entityType, data.format);
        const mimeType = formatter.getContentType(data.format);
        const objectKey = await storage.uploadFile(tenantId, 'exports', fileName, buffer, mimeType);
        const signedUrl = await storage.getSignedUrl(objectKey, 86400);

        await db
          .update(exportJobs)
          .set({
            status: 'READY',
            s3Key: objectKey,
            signedUrl,
            totalRows,
            completedAt: new Date(),
          })
          .where(eq(exportJobs.id, data.jobId));

        logger.info(
          { tenantId, jobId: data.jobId, entityType: data.entityType, totalRows, durationMs: Date.now() - start },
          'Export generated'
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db
          .update(exportJobs)
          .set({ status: 'FAILED', errorMessage })
          .where(eq(exportJobs.id, data.jobId));
        throw err;
      }
    }
  );
}
