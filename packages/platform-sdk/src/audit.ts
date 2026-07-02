import { auditLog } from '@erp/db';
import type { TenantScopedDatabase } from './database.js';

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Audit log is APPEND-ONLY — never UPDATE or DELETE (ERP_MASTER_SPEC §13 rule 4)
export class PlatformAuditLogger {
  constructor(
    private readonly db: TenantScopedDatabase,
    private readonly userId: number
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.db.raw.insert(auditLog).values({
      tenantId: this.db.tenantId,
      userId: this.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      beforeData: entry.before ?? null,
      afterData: entry.after ?? null,
      metadata: entry.metadata ?? null,
    });
  }

  // Bulk audit for saga operations
  async logBatch(entries: AuditLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await this.db.raw.insert(auditLog).values(
      entries.map((entry) => ({
        tenantId: this.db.tenantId,
        userId: this.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        beforeData: entry.before ?? null,
        afterData: entry.after ?? null,
        metadata: entry.metadata ?? null,
      }))
    );
  }
}
