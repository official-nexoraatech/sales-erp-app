import { type SQL, sql, eq, and, isNull } from 'drizzle-orm';
import { type PgTable, type TableConfig } from 'drizzle-orm/pg-core';
import { type ErpDatabase, type OutboxEvent, outboxEvents } from '@erp/db';
import { SecurityError } from '@erp/types';

export class TenantScopedDatabase {
  constructor(
    public readonly tenantId: number,
    private readonly _db: ErpDatabase
  ) {
    if (!tenantId || tenantId <= 0) {
      throw new SecurityError('Tenant context is required — access denied');
    }
  }

  get raw(): ErpDatabase {
    return this._db;
  }

  async transaction<T>(fn: (trx: TenantScopedDatabase) => Promise<T>): Promise<T> {
    return this._db.transaction(async (trx) => {
      // Set PostgreSQL session variable for Row Level Security
      await trx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${this.tenantId.toString()}, true)`
      );
      return fn(new TenantScopedDatabase(this.tenantId, trx as unknown as ErpDatabase));
    });
  }

  // Auto-inject tenant_id on INSERT
  async insert<T extends PgTable<TableConfig>>(
    table: T,
    values: Omit<typeof table.$inferInsert, 'tenantId' | 'createdAt' | 'updatedAt'>
  ): Promise<typeof table.$inferSelect> {
    const result = await this._db
      .insert(table)
      .values({ ...(values as Record<string, unknown>), tenantId: this.tenantId } as never)
      .returning();
    const row = result[0];
    if (!row) throw new Error('Insert returned no rows');
    return row as typeof table.$inferSelect;
  }

  // Auto-inject tenant_id + soft delete filter on SELECT
  async findMany<T extends PgTable<TableConfig>>(
    table: T,
    where?: SQL,
    options?: { limit?: number; offset?: number }
  ): Promise<(typeof table.$inferSelect)[]> {
    const tableAny = table as unknown as { tenantId: SQL; deletedAt?: SQL };
    const tenantFilter = eq(tableAny.tenantId as SQL, this.tenantId as unknown as SQL);
    const conditions: SQL[] = [tenantFilter];

    if ('deletedAt' in tableAny && tableAny.deletedAt) {
      conditions.push(isNull(tableAny.deletedAt as SQL));
    }
    if (where) conditions.push(where);

    const combinedWhere = and(...conditions);
    const query = this._db.select().from(table).where(combinedWhere);

    if (options?.limit !== undefined) (query as unknown as { limit: (n: number) => typeof query }).limit(options.limit);
    if (options?.offset !== undefined) (query as unknown as { offset: (n: number) => typeof query }).offset(options.offset);

    return query as unknown as Promise<(typeof table.$inferSelect)[]>;
  }

  // Write to outbox in an existing transaction (Outbox Pattern §4.4)
  async insertIntoOutbox(
    data: Omit<OutboxEvent, 'id' | 'published' | 'publishedAt' | 'createdAt' | 'tenantId'>
  ): Promise<void> {
    await this._db.insert(outboxEvents).values({
      ...data,
      tenantId: this.tenantId,
      published: false,
    });
  }

  async execute(query: SQL): Promise<unknown> {
    return this._db.execute(query);
  }
}
