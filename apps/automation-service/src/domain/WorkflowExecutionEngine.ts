import { eq } from 'drizzle-orm';
import { workflowExecutionHistory, type WorkflowDefinition, type WorkflowNode } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { evaluateConditions } from '@erp/sdk';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'automation-service' });

// v1 scope: this engine walks CONDITION/NOTIFICATION/ACTION/DELAY node chains — the new
// capability automation-service adds. APPROVAL/PARALLEL_APPROVAL nodes remain entirely owned
// by the existing WorkflowEngine (packages/platform-sdk/src/workflow.ts), triggered directly
// by domain services (InvoiceService, PurchaseOrderService) exactly as built in the Business
// Rules Engine feature — this engine does not (yet) interleave with an APPROVAL node
// mid-chain; a definition whose first node is APPROVAL-typed is WorkflowEngine's alone. See
// the plan file's Feature 2 section for why this split, not a merged interpreter, in v1.
export interface NotificationDispatcher {
  notifyRole(tenantId: number, roleName: string, message: string): Promise<void>;
  notifyUser(tenantId: number, userId: number, message: string): Promise<void>;
}

export interface ActionPublisher {
  publish(tenantId: number, eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export class WorkflowExecutionEngine {
  constructor(
    private readonly db: ErpDatabase,
    private readonly notifier: NotificationDispatcher,
    private readonly actionPublisher: ActionPublisher
  ) {}

  async execute(
    definition: WorkflowDefinition,
    payload: Record<string, unknown>,
    triggeredBy: 'EVENT' | 'CRON' | 'WEBHOOK' | 'API' | 'MANUAL'
  ): Promise<void> {
    const nodes = definition.nodes as WorkflowNode[];
    const nodeResults: Array<{
      nodeId: string;
      type: string;
      status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      error?: string;
    }> = [];

    const [historyRow] = await this.db
      .insert(workflowExecutionHistory)
      .values({
        tenantId: definition.tenantId,
        definitionId: definition.id,
        triggeredBy,
        status: 'RUNNING',
        triggerPayload: payload,
      })
      .returning();

    let overallStatus: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let overallError: string | undefined;

    try {
      // Resolves a next/rejected-node reference — undefined means "end of chain" (legitimate,
      // the definition author simply didn't wire a step there), but a *set* id that doesn't
      // match any node in the array is a malformed definition (e.g. a typo in the builder
      // UI's "next step id" field) and must fail loudly rather than silently truncating the
      // automation with no error anyone would ever see.
      const resolveNext = (nodeId: string | undefined): WorkflowNode | undefined => {
        if (!nodeId) return undefined;
        const found = nodes.find((n) => n.id === nodeId);
        if (!found) throw new Error(`Step "${nodeId}" referenced but not found in this definition`);
        return found;
      };

      let current: WorkflowNode | undefined = nodes[0];
      const visited = new Set<string>();
      while (current) {
        if (visited.has(current.id)) {
          // Defensive — a malformed definition with a cycle must not hang the engine forever.
          throw new Error(`Cycle detected at node ${current.id}`);
        }
        visited.add(current.id);

        const result = await this.executeNode(definition.tenantId, current, payload);
        nodeResults.push(result);

        if (result.status === 'FAILED') {
          overallStatus = 'FAILED';
          overallError = result.error;
          break;
        }
        if (result.status === 'SKIPPED') {
          // CONDITION failed — follow rejectedNodeId if the author defined one, else stop here
          // (matches WorkflowEngine's own REJECTED-path convention for consistency).
          current = resolveNext(current.rejectedNodeId);
          continue;
        }
        current = resolveNext(current.nextNodeId);
      }
    } catch (err) {
      overallStatus = 'FAILED';
      overallError = err instanceof Error ? err.message : String(err);
      logger.error({ err, definitionId: definition.id }, 'Workflow execution failed');
    }

    if (historyRow) {
      await this.db
        .update(workflowExecutionHistory)
        .set({
          status: overallStatus,
          nodeResults,
          ...(overallError !== undefined ? { errorMessage: overallError } : {}),
          completedAt: new Date(),
        })
        .where(eq(workflowExecutionHistory.id, historyRow.id));
    }
  }

  private async executeNode(
    tenantId: number,
    node: WorkflowNode,
    payload: Record<string, unknown>
  ): Promise<{
    nodeId: string;
    type: string;
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
    error?: string;
  }> {
    try {
      switch (node.type) {
        case 'CONDITION': {
          const passed = evaluateConditions(
            (node.conditions ?? []) as never,
            node.conditionOperator ?? 'AND',
            payload
          );
          return { nodeId: node.id, type: node.type, status: passed ? 'COMPLETED' : 'SKIPPED' };
        }
        case 'NOTIFICATION': {
          const message = node.message ?? `Automation notification: ${node.name}`;
          if (node.approverType === 'ROLE' && node.approverRef) {
            await this.notifier.notifyRole(tenantId, node.approverRef, message);
          } else if (node.approverType === 'USER' && node.approverRef) {
            await this.notifier.notifyUser(tenantId, Number(node.approverRef), message);
          }
          return { nodeId: node.id, type: node.type, status: 'COMPLETED' };
        }
        case 'ACTION': {
          if (node.actionEventType) {
            await this.actionPublisher.publish(tenantId, node.actionEventType, payload);
          }
          return { nodeId: node.id, type: node.type, status: 'COMPLETED' };
        }
        case 'DELAY':
          // v1: DELAY nodes are honored by the trigger layer rescheduling the whole run (see
          // TriggerRegistry) — reaching one here mid-walk is treated as a no-op pass-through
          // rather than a second delay mechanism.
          return { nodeId: node.id, type: node.type, status: 'COMPLETED' };
        default:
          // APPROVAL/PARALLEL_APPROVAL reaching here means a malformed definition (should be
          // WorkflowEngine's alone, never nodes[0] of an automation-triggered chain) — fail
          // loudly rather than silently no-op.
          return {
            nodeId: node.id,
            type: node.type,
            status: 'FAILED',
            error: `Node type ${node.type} is not executable by WorkflowExecutionEngine (approval nodes are owned by WorkflowEngine)`,
          };
      }
    } catch (err) {
      return {
        nodeId: node.id,
        type: node.type,
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
