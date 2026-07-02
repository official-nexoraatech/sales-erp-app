import nodemailer from 'nodemailer';
import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { reportSchedules, reportRunHistory } from '@erp/db';
import { ReportEngine } from '../domain/ReportEngine.js';
import { ReportFormatter } from '../domain/ReportFormatter.js';
import { getReportDefinition } from '../domain/ReportRegistry.js';

type DbClient = ErpDatabase;

export class ScheduledReportJob {
  private readonly engine: ReportEngine;
  private readonly formatter: ReportFormatter;
  private readonly transporter: nodemailer.Transporter;
  private readonly jobs: Map<number, Cron> = new Map();

  constructor(
    private readonly db: DbClient,
    private readonly logger: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void }
  ) {
    this.engine = new ReportEngine(db);
    this.formatter = new ReportFormatter();
    this.transporter = nodemailer.createTransport({
      host: process.env['SMTP_HOST'] ?? 'localhost',
      port: parseInt(process.env['SMTP_PORT'] ?? '1025', 10),
      secure: false,
      auth: process.env['SMTP_USER']
        ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] ?? '' }
        : undefined,
    });
  }

  async start(): Promise<void> {
    this.logger.info({}, 'ScheduledReportJob starting — loading active schedules');
    await this.loadSchedules();

    // Reload schedules every 5 minutes to pick up new/deleted schedules
    new Cron('*/5 * * * *', async () => {
      await this.loadSchedules();
    });
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  private async loadSchedules(): Promise<void> {
    const active = await this.db
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.active, 1));

    const activeIds = new Set(active.map((s) => s.id));

    // Stop removed schedules
    for (const [id, job] of this.jobs) {
      if (!activeIds.has(id)) {
        job.stop();
        this.jobs.delete(id);
        this.logger.info({ scheduleId: id }, 'Stopped removed schedule');
      }
    }

    // Add new schedules
    for (const schedule of active) {
      if (!this.jobs.has(schedule.id)) {
        try {
          const job = new Cron(schedule.cronExpression, async () => {
            await this.runSchedule(schedule);
          });
          this.jobs.set(schedule.id, job);
          this.logger.info({ scheduleId: schedule.id, cron: schedule.cronExpression }, 'Scheduled report job registered');
        } catch (err) {
          this.logger.error({ scheduleId: schedule.id, err }, 'Failed to register schedule');
        }
      }
    }
  }

  private async runSchedule(schedule: typeof reportSchedules.$inferSelect): Promise<void> {
    const startTime = Date.now();
    this.logger.info({ scheduleId: schedule.id, slug: schedule.reportSlug }, 'Running scheduled report');

    const definition = getReportDefinition(schedule.reportSlug);
    if (!definition) {
      this.logger.error({ slug: schedule.reportSlug }, 'Report definition not found for schedule');
      return;
    }

    const [run] = await this.db.insert(reportRunHistory).values({
      tenantId: schedule.tenantId,
      scheduleId: schedule.id,
      reportSlug: schedule.reportSlug,
      params: schedule.params as Record<string, string>,
      format: schedule.format,
      status: 'RUNNING',
      startedAt: new Date(),
      triggeredBy: 'SCHEDULED',
    }).returning();

    try {
      const params = schedule.params as Record<string, string>;
      const result = await this.engine.generate(schedule.reportSlug, schedule.tenantId, params);

      let attachment: { filename: string; content: Buffer | string; contentType: string } | undefined;
      const fmt = schedule.format;

      if (fmt === 'EXCEL') {
        attachment = {
          filename: this.formatter.getFileName(schedule.reportSlug, 'EXCEL'),
          content: this.formatter.toExcel(definition, result),
          contentType: this.formatter.getContentType('EXCEL'),
        };
      } else if (fmt === 'CSV') {
        attachment = {
          filename: this.formatter.getFileName(schedule.reportSlug, 'CSV'),
          content: this.formatter.toCSV(definition, result),
          contentType: 'text/csv',
        };
      }

      const recipients = schedule.recipients as string[];
      const unsubscribeUrl = `${process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015'}/api/v2/unsubscribe/${schedule.unsubscribeToken}`;

      const emailHtml = `
        <h2>${definition.name}</h2>
        <p>Your scheduled report is ready.</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
          <tr><th>Report</th><td>${definition.name}</td></tr>
          <tr><th>Category</th><td>${definition.category}</td></tr>
          <tr><th>Generated At</th><td>${result.generatedAt}</td></tr>
          <tr><th>Total Rows</th><td>${result.totalRows}</td></tr>
          <tr><th>Format</th><td>${fmt}</td></tr>
        </table>
        ${result.totalRows <= 100 && fmt === 'CSV' ? `
          <br>
          <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:12px">
            <tr>${definition.columns.map((c) => `<th style="background:#f0f0f0">${c.label}</th>`).join('')}</tr>
            ${result.rows.slice(0, 100).map((row) => `<tr>${definition.columns.map((c) => `<td>${row[c.key] ?? ''}</td>`).join('')}</tr>`).join('')}
          </table>
        ` : '<p>See the attached file for the full report data.</p>'}
        <br>
        <small><a href="${unsubscribeUrl}">Unsubscribe from this report</a></small>
      `;

      await this.transporter.sendMail({
        from: process.env['SMTP_FROM'] ?? 'erp@nexoraa.com',
        to: recipients.join(', '),
        subject: `[ERP Report] ${definition.name} — ${new Date().toLocaleDateString('en-IN')}`,
        html: emailHtml,
        attachments: attachment ? [attachment] : undefined,
      });

      await this.db.update(reportRunHistory)
        .set({
          status: 'COMPLETED',
          completedAt: new Date(),
          rowCount: result.totalRows,
          durationMs: Date.now() - startTime,
        })
        .where(eq(reportRunHistory.id, run!.id));

      this.logger.info({ scheduleId: schedule.id, recipients: recipients.length, rows: result.totalRows }, 'Scheduled report dispatched');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error({ scheduleId: schedule.id, err: errorMessage }, 'Scheduled report failed');

      await this.db.update(reportRunHistory)
        .set({
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage,
          durationMs: Date.now() - startTime,
        })
        .where(eq(reportRunHistory.id, run!.id));
    }
  }
}
