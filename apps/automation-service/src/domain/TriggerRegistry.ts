import { and, eq } from 'drizzle-orm';
import { workflowDefinitions, type WorkflowDefinition } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { createLogger } from '@erp/logger';
import type { WorkflowExecutionEngine } from './WorkflowExecutionEngine.js';

const logger = createLogger({ serviceName: 'automation-service' });

// v1 scope note: only matches definitions whose first node is NOT an APPROVAL type — those
// remain WorkflowEngine's, triggered directly by the owning domain service (see
// WorkflowExecutionEngine.ts's header comment for the full reasoning).
function isAutomationChain(def: WorkflowDefinition): boolean {
  const nodes = def.nodes as Array<{ type?: string }>;
  const first = nodes[0];
  return !!first && first.type !== 'APPROVAL' && first.type !== 'PARALLEL_APPROVAL';
}

export class TriggerRegistry {
  constructor(
    private readonly db: ErpDatabase,
    private readonly engine: WorkflowExecutionEngine
  ) {}

  // Called by the Kafka consumer in main.ts for every outbox-derived event this service
  // subscribes to. Matches on (tenantId, triggerEvent, triggerType='EVENT', isActive).
  async handleEvent(
    tenantId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const defs = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, tenantId),
          eq(workflowDefinitions.triggerEvent, eventType),
          eq(workflowDefinitions.triggerType, 'EVENT'),
          eq(workflowDefinitions.isActive, true)
        )
      );

    for (const def of defs) {
      if (!isAutomationChain(def)) continue; // approval-chain — WorkflowEngine's, not ours
      try {
        await this.engine.execute(def, payload, 'EVENT');
      } catch (err) {
        logger.error(
          { err, definitionId: def.id, eventType },
          'Automation execution failed for event trigger'
        );
      }
    }
  }

  // Called by a BullMQ repeatable job (see main.ts) once per active CRON-type definition.
  async handleCron(definitionId: number, tenantId: number): Promise<void> {
    const [def] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.id, definitionId),
          eq(workflowDefinitions.tenantId, tenantId),
          eq(workflowDefinitions.triggerType, 'CRON'),
          eq(workflowDefinitions.isActive, true)
        )
      );
    if (!def || !isAutomationChain(def)) return;
    await this.engine.execute(def, {}, 'CRON');
  }

  // Called by the manual-trigger API route (AUTOMATION_EXECUTE) and the API-key-authenticated
  // public trigger route (triggerType='API').
  async handleManualOrApiTrigger(
    definitionId: number,
    tenantId: number,
    payload: Record<string, unknown>,
    triggeredBy: 'MANUAL' | 'API'
  ): Promise<void> {
    const [def] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, tenantId))
      );
    if (!def) return;
    if (!isAutomationChain(def)) return;
    await this.engine.execute(def, payload, triggeredBy);
  }
}
