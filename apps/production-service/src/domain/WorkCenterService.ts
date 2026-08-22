import { and, eq } from 'drizzle-orm';
import { workCenters } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface CreateWorkCenterParams {
  tenantId: number;
  name: string;
  code: string;
  description?: string | undefined;
  capacityPerDay?: number | undefined;
  createdBy: number;
}

export interface UpdateWorkCenterParams {
  name?: string | undefined;
  description?: string | undefined;
  capacityPerDay?: number | undefined;
  isActive?: boolean | undefined;
}

// Manufacturing vertical, Phase B — the dependency root for the later-deferred Routing/MRP
// slices (still not built), but standalone useful now: a Job Work Order can optionally reference
// one for capacity tracking/reporting (see JobWorkOrderService's workCenterId param).
export class WorkCenterService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateWorkCenterParams): Promise<number> {
    const [existing] = await this.db
      .select({ id: workCenters.id })
      .from(workCenters)
      .where(and(eq(workCenters.tenantId, params.tenantId), eq(workCenters.code, params.code)));
    if (existing) {
      throw new BusinessError(
        'WORK_CENTER_CODE_TAKEN',
        `Work center code ${params.code} is already in use`
      );
    }

    const [row] = await this.db
      .insert(workCenters)
      .values({
        tenantId: params.tenantId,
        name: params.name,
        code: params.code,
        description: params.description,
        capacityPerDay: String(params.capacityPerDay ?? 0),
        createdBy: params.createdBy,
      })
      .returning({ id: workCenters.id });

    if (!row) throw new BusinessError('WORK_CENTER_CREATE_FAILED', 'Failed to create work center');
    return row.id;
  }

  async update(id: number, tenantId: number, params: UpdateWorkCenterParams): Promise<void> {
    const [existing] = await this.db
      .select({ id: workCenters.id })
      .from(workCenters)
      .where(and(eq(workCenters.id, id), eq(workCenters.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('WorkCenter', id);

    await this.db
      .update(workCenters)
      .set({
        name: params.name,
        description: params.description,
        capacityPerDay:
          params.capacityPerDay !== undefined ? String(params.capacityPerDay) : undefined,
        isActive: params.isActive,
        updatedAt: new Date(),
      })
      .where(and(eq(workCenters.id, id), eq(workCenters.tenantId, tenantId)));
  }

  async getById(id: number, tenantId: number): Promise<typeof workCenters.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(workCenters)
      .where(and(eq(workCenters.id, id), eq(workCenters.tenantId, tenantId)));
    return row ?? null;
  }

  async list(tenantId: number): Promise<(typeof workCenters.$inferSelect)[]> {
    return this.db.select().from(workCenters).where(eq(workCenters.tenantId, tenantId));
  }
}
