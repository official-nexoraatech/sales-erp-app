import { and, desc, eq } from 'drizzle-orm';
import { workflowDefinitions, type WorkflowNode } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface WorkflowDefinitionInput {
  name: string;
  triggerEvent: string;
  entityType: string;
  triggerType: 'EVENT' | 'CRON' | 'WEBHOOK' | 'API';
  triggerConfig?: Record<string, unknown>;
  conditionExpr?: {
    field: string;
    operator: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' | 'ALWAYS';
    value?: number | string;
  };
  nodes: WorkflowNode[];
  timeoutHours?: number;
  isActive: boolean;
}

// Closes a real gap: WorkflowEngine's 20 system approval chains were the only workflow
// definitions that ever existed — "WORKFLOW_CONFIG had zero implementation surface" (see
// PG-014's comment in packages/shared-types/src/permissions.ts). This is the first CRUD
// surface for tenant-authored definitions, of any trigger type.
export class WorkflowDefinitionService {
  constructor(private readonly db: ErpDatabase) {}

  async list(tenantId: number) {
    return this.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.tenantId, tenantId))
      .orderBy(desc(workflowDefinitions.createdAt));
  }

  async get(id: number, tenantId: number) {
    const [row] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!row) throw new NotFoundError('WorkflowDefinition', id);
    return row;
  }

  async create(tenantId: number, userId: number, input: WorkflowDefinitionInput) {
    const [row] = await this.db
      .insert(workflowDefinitions)
      .values({
        tenantId,
        name: input.name,
        triggerEvent: input.triggerEvent,
        entityType: input.entityType,
        triggerType: input.triggerType,
        ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig } : {}),
        conditionExpr: input.conditionExpr ?? { field: '', operator: 'ALWAYS' },
        nodes: input.nodes,
        timeoutHours: input.timeoutHours ?? 48,
        isActive: input.isActive,
        isSystem: false,
        createdBy: userId,
      })
      .returning();
    if (!row)
      throw new BusinessError('WORKFLOW_CREATE_FAILED', 'Failed to create workflow definition');
    return row;
  }

  async update(id: number, tenantId: number, input: WorkflowDefinitionInput) {
    const existing = await this.get(id, tenantId);
    await this.db
      .update(workflowDefinitions)
      .set({
        name: input.name,
        triggerEvent: input.triggerEvent,
        entityType: input.entityType,
        triggerType: input.triggerType,
        ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig } : {}),
        conditionExpr: input.conditionExpr ?? { field: '', operator: 'ALWAYS' },
        nodes: input.nodes,
        timeoutHours: input.timeoutHours ?? existing.timeoutHours,
        isActive: input.isActive,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(eq(workflowDefinitions.id, id));
    return this.get(id, tenantId);
  }

  async toggle(id: number, tenantId: number, isActive: boolean) {
    await this.get(id, tenantId); // 404s if not found/wrong tenant
    await this.db
      .update(workflowDefinitions)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(workflowDefinitions.id, id));
  }

  async remove(id: number, tenantId: number) {
    const existing = await this.get(id, tenantId);
    if (existing.isSystem) {
      throw new BusinessError('WORKFLOW_SYSTEM', 'Cannot delete a system workflow definition');
    }
    await this.db.delete(workflowDefinitions).where(eq(workflowDefinitions.id, id));
  }
}
