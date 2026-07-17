import { eq, and } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import {
  workflowDefinitions,
  workflowInstances,
  workflowApprovals,
  roles,
  userRoles,
  users,
} from '@erp/db';
import type { WorkflowNode } from '@erp/db';
import { NotFoundError, BusinessError } from '@erp/types';

export interface WorkflowTriggerInput {
  event: string;
  entityType: string;
  entityId: number;
  userId: number;
  correlationId: string;
  payload?: Record<string, unknown>;
}

export interface ApprovalDecisionInput {
  instanceId: number;
  nodeId: string;
  userId: number;
  comment?: string;
}

export interface WorkflowStatus {
  instanceId: number;
  status: string;
  currentNodeId: string | null;
  pendingApprovals: Array<{
    id: number;
    nodeId: string;
    nodeName: string;
    approverId: number;
    action: string;
  }>;
  history: (typeof workflowApprovals.$inferSelect)[];
}

export interface PendingApprovalItem {
  approvalId: number;
  instanceId: number;
  nodeId: string;
  nodeName: string;
  entityType: string;
  entityId: number;
  triggeredByUserId: number;
  createdAt: Date;
}

// 20 workflow definitions seeded per tenant (covering ERP_MASTER_SPEC §14 triggers)
export const SYSTEM_WORKFLOW_DEFINITIONS: Array<{
  name: string;
  triggerEvent: string;
  entityType: string;
  conditionExpr: {
    field: string;
    operator: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' | 'ALWAYS';
    value?: number;
  };
  nodes: WorkflowNode[];
  timeoutHours: number;
  isSystem: boolean;
}> = [
  {
    name: 'Sale Invoice — High Value Approval',
    triggerEvent: 'INVOICE_CREATE',
    entityType: 'Invoice',
    conditionExpr: { field: 'grandTotal', operator: 'GT', value: 50000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Discount Override Approval',
    triggerEvent: 'DISCOUNT_OVERRIDE_REQUESTED',
    entityType: 'Invoice',
    conditionExpr: { field: 'discountPercent', operator: 'GT', value: 20 },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 12,
    isSystem: true,
  },
  {
    name: 'Purchase Order — High Value Approval',
    triggerEvent: 'PO_CREATE',
    entityType: 'PurchaseOrder',
    conditionExpr: { field: 'totalAmount', operator: 'GT', value: 100000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Purchase Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'PURCHASE_MANAGER',
        nextNodeId: 'node_2',
      },
      {
        id: 'node_2',
        name: 'Owner Final Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'OWNER',
      },
    ],
    timeoutHours: 48,
    isSystem: true,
  },
  {
    name: 'GRN Price Variance Approval',
    triggerEvent: 'GRN_PRICE_VARIANCE',
    entityType: 'GRN',
    conditionExpr: { field: 'variancePercent', operator: 'GT', value: 5 },
    nodes: [
      {
        id: 'node_1',
        name: 'Purchase Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'PURCHASE_MANAGER',
      },
    ],
    timeoutHours: 12,
    isSystem: true,
  },
  {
    name: 'Expense Approval',
    triggerEvent: 'EXPENSE_CREATE',
    entityType: 'Expense',
    conditionExpr: { field: 'amount', operator: 'GT', value: 5000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Department Head Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'ADMIN',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Stock Adjustment Approval',
    triggerEvent: 'STOCK_ADJUST',
    entityType: 'StockAdjustment',
    conditionExpr: { field: 'adjustmentValue', operator: 'GT', value: 10000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Inventory Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'INVENTORY_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Payroll Release Approval',
    triggerEvent: 'PAYROLL_PROCESS',
    entityType: 'Payroll',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Owner Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'OWNER',
      },
    ],
    timeoutHours: 48,
    isSystem: true,
  },
  {
    name: 'Financial Year Close Approval',
    triggerEvent: 'FINANCIAL_YEAR_CLOSE',
    entityType: 'FinancialYear',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Owner Final Confirmation',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'OWNER',
      },
    ],
    timeoutHours: 72,
    isSystem: true,
  },
  {
    name: 'Customer Credit Limit Approval',
    triggerEvent: 'CUSTOMER_CREDIT_LIMIT_CHANGE',
    entityType: 'Customer',
    conditionExpr: { field: 'newCreditLimit', operator: 'GT', value: 100000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Sale Return Approval',
    triggerEvent: 'SALE_RETURN_CREATE',
    entityType: 'SaleReturn',
    conditionExpr: { field: 'returnAmount', operator: 'GT', value: 10000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 12,
    isSystem: true,
  },
  {
    name: 'Supplier Payment Approval',
    triggerEvent: 'PAYMENT_OUT_CREATE',
    entityType: 'SupplierPayment',
    conditionExpr: { field: 'amount', operator: 'GT', value: 50000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Purchase Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'PURCHASE_MANAGER',
        nextNodeId: 'node_2',
      },
      {
        id: 'node_2',
        name: 'Owner Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'OWNER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'New Employee Onboarding Approval',
    triggerEvent: 'EMPLOYEE_CREATE',
    entityType: 'Employee',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'HR Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'HR_MANAGER',
      },
    ],
    timeoutHours: 48,
    isSystem: true,
  },
  {
    name: 'Leave Approval',
    triggerEvent: 'LEAVE_APPLY',
    entityType: 'Leave',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'HR_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Stock Transfer Approval',
    triggerEvent: 'STOCK_TRANSFER',
    entityType: 'StockTransfer',
    conditionExpr: { field: 'transferValue', operator: 'GT', value: 25000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Inventory Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'INVENTORY_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Credit Note Approval',
    triggerEvent: 'CREDIT_NOTE_CREATE',
    entityType: 'CreditNote',
    conditionExpr: { field: 'amount', operator: 'GT', value: 5000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 12,
    isSystem: true,
  },
  {
    name: 'Bulk Import Approval',
    triggerEvent: 'BULK_IMPORT_EXECUTE',
    entityType: 'ImportJob',
    conditionExpr: { field: 'totalRows', operator: 'GT', value: 1000 },
    nodes: [
      {
        id: 'node_1',
        name: 'Admin Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'ADMIN',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Price List Change Approval',
    triggerEvent: 'PRICE_LIST_UPDATE',
    entityType: 'PriceList',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Purchase Return Approval',
    triggerEvent: 'PURCHASE_RETURN_CREATE',
    entityType: 'PurchaseReturn',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Purchase Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'PURCHASE_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Item Deletion Approval',
    triggerEvent: 'ITEM_DELETE',
    entityType: 'Item',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Inventory Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'INVENTORY_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
  {
    name: 'Customer Block Approval',
    triggerEvent: 'CUSTOMER_BLOCK',
    entityType: 'Customer',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes: [
      {
        id: 'node_1',
        name: 'Sales Manager Approval',
        type: 'APPROVAL',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
      },
    ],
    timeoutHours: 24,
    isSystem: true,
  },
];

export class WorkflowEngine {
  constructor(
    private readonly db: ErpDatabase,
    private readonly tenantId: number,
    private readonly userId: number,
    private readonly correlationId: string
  ) {}

  async trigger(
    input: WorkflowTriggerInput
  ): Promise<typeof workflowInstances.$inferSelect | null> {
    // Find matching active workflow definition
    const defs = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, this.tenantId),
          eq(workflowDefinitions.triggerEvent, input.event),
          eq(workflowDefinitions.isActive, true)
        )
      )
      .limit(1);

    const definition = defs[0];
    if (!definition) return null;

    const condition = definition.conditionExpr as {
      field: string;
      operator: string;
      value?: number;
    };
    if (!this.evaluateCondition(condition, input.payload ?? {})) return null;

    const nodes = definition.nodes as WorkflowNode[];
    const firstNode = nodes[0];
    if (!firstNode) return null;

    const expiresAt = new Date(Date.now() + definition.timeoutHours * 3600 * 1000);

    const [instance] = await this.db
      .insert(workflowInstances)
      .values({
        tenantId: this.tenantId,
        definitionId: definition.id,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'PENDING',
        currentNodeId: firstNode.id,
        correlationId: input.correlationId,
        triggeredByUserId: input.userId,
        triggerPayload: input.payload ?? {},
        expiresAt,
        createdBy: input.userId,
      })
      .returning();

    if (!instance) throw new Error('Failed to create workflow instance');

    // Resolve approver(s) and create one approval record per eligible approver for first node
    const approvers = await this.resolveApprovers(firstNode);
    for (const approver of approvers) {
      await this.createApprovalRecord(instance.id, firstNode, approver, input.userId);
    }

    return instance;
  }

  async approve(input: ApprovalDecisionInput): Promise<void> {
    return this.processDecision({ ...input, action: 'APPROVED' as const });
  }

  async reject(input: ApprovalDecisionInput): Promise<void> {
    return this.processDecision({ ...input, action: 'REJECTED' as const });
  }

  async getStatus(instanceId: number): Promise<WorkflowStatus> {
    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(
        and(eq(workflowInstances.id, instanceId), eq(workflowInstances.tenantId, this.tenantId))
      );

    if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);

    const approvals = await this.db
      .select()
      .from(workflowApprovals)
      .where(
        and(
          eq(workflowApprovals.instanceId, instanceId),
          eq(workflowApprovals.tenantId, this.tenantId)
        )
      );

    return {
      instanceId,
      status: instance.status,
      currentNodeId: instance.currentNodeId ?? null,
      pendingApprovals: approvals
        .filter((a) => a.action === 'PENDING' && a.nodeId === instance.currentNodeId)
        .map((a) => ({
          id: a.id,
          nodeId: a.nodeId,
          nodeName: a.nodeName,
          approverId: a.approverId,
          action: a.action,
        })),
      history: approvals,
    };
  }

  async getPendingForApprover(approverId: number): Promise<PendingApprovalItem[]> {
    const approvals = await this.db
      .select()
      .from(workflowApprovals)
      .where(
        and(
          eq(workflowApprovals.approverId, approverId),
          eq(workflowApprovals.action, 'PENDING'),
          eq(workflowApprovals.tenantId, this.tenantId)
        )
      );

    const items: PendingApprovalItem[] = [];
    for (const approval of approvals) {
      const [instance] = await this.db
        .select()
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.id, approval.instanceId),
            eq(workflowInstances.status, 'PENDING')
          )
        );

      if (instance && instance.currentNodeId === approval.nodeId) {
        items.push({
          approvalId: approval.id,
          instanceId: approval.instanceId,
          nodeId: approval.nodeId,
          nodeName: approval.nodeName,
          entityType: instance.entityType,
          entityId: instance.entityId,
          triggeredByUserId: instance.triggeredByUserId,
          createdAt: approval.createdAt,
        });
      }
    }
    return items;
  }

  async seedDefinitions(): Promise<void> {
    for (const def of SYSTEM_WORKFLOW_DEFINITIONS) {
      await this.db
        .insert(workflowDefinitions)
        .values({
          tenantId: this.tenantId,
          name: def.name,
          triggerEvent: def.triggerEvent,
          entityType: def.entityType,
          conditionExpr: def.conditionExpr,
          nodes: def.nodes,
          timeoutHours: def.timeoutHours,
          isSystem: def.isSystem,
          isActive: true,
          createdBy: 0,
        })
        .onConflictDoNothing();
    }
  }

  private async processDecision(
    input: ApprovalDecisionInput & { action: 'APPROVED' | 'REJECTED' }
  ): Promise<void> {
    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(
        and(
          eq(workflowInstances.id, input.instanceId),
          eq(workflowInstances.tenantId, this.tenantId)
        )
      );

    if (!instance) throw new NotFoundError('WorkflowInstance', input.instanceId);
    if (instance.status !== 'PENDING') {
      throw new BusinessError('WORKFLOW_ALREADY_DECIDED', `Instance is already ${instance.status}`);
    }

    // Record the decision
    await this.db
      .update(workflowApprovals)
      .set({
        action: input.action,
        comment: input.comment,
        decidedAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      })
      .where(
        and(
          eq(workflowApprovals.instanceId, input.instanceId),
          eq(workflowApprovals.nodeId, input.nodeId),
          eq(workflowApprovals.approverId, input.userId)
        )
      );

    if (input.action === 'REJECTED') {
      await this.finalizeInstance(instance.id, 'REJECTED');
      return;
    }

    // Get workflow definition to find next node
    const [definition] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, instance.definitionId));

    if (!definition) throw new NotFoundError('WorkflowDefinition', instance.definitionId);

    const nodes = definition.nodes as WorkflowNode[];
    const currentNode = nodes.find((n) => n.id === input.nodeId);
    if (!currentNode) throw new BusinessError('INVALID_NODE', `Node ${input.nodeId} not found`);

    if (currentNode.requireAllApprovers) {
      const siblingApprovals = await this.db
        .select()
        .from(workflowApprovals)
        .where(
          and(
            eq(workflowApprovals.instanceId, instance.id),
            eq(workflowApprovals.nodeId, input.nodeId)
          )
        );
      // Wait for every eligible approver on this node to approve before advancing.
      if (!siblingApprovals.every((a) => a.action === 'APPROVED')) return;
    }

    if (currentNode.nextNodeId) {
      const nextNode = nodes.find((n) => n.id === currentNode.nextNodeId);
      if (nextNode) {
        await this.db
          .update(workflowInstances)
          .set({ currentNodeId: nextNode.id, updatedAt: new Date(), version: instance.version + 1 })
          .where(eq(workflowInstances.id, instance.id));

        const approvers = await this.resolveApprovers(nextNode);
        for (const approver of approvers) {
          await this.createApprovalRecord(instance.id, nextNode, approver, input.userId);
        }
        return;
      }
    }

    await this.finalizeInstance(instance.id, 'APPROVED');
  }

  private async finalizeInstance(
    instanceId: number,
    status: 'APPROVED' | 'REJECTED'
  ): Promise<void> {
    await this.db
      .update(workflowInstances)
      .set({ status, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowInstances.id, instanceId));
  }

  // Resolves a node's approver to the real user(s) who can act on it. For ROLE-type nodes
  // this returns every active user holding that role (a role can have zero, one, or many
  // users) — approverRoleId is carried alongside so the created approval rows record which
  // role granted eligibility, not just which user acted.
  private async resolveApprovers(
    node: WorkflowNode
  ): Promise<Array<{ userId: number; roleId: number | null }>> {
    if (node.approverType === 'ROLE') {
      const [role] = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, node.approverRef), eq(roles.tenantId, this.tenantId)));

      if (!role) return [];

      const eligible = await this.db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(
            eq(userRoles.roleId, role.id),
            eq(userRoles.tenantId, this.tenantId),
            eq(users.isActive, true)
          )
        );

      return eligible.map((u) => ({ userId: u.userId, roleId: role.id }));
    }
    const userId = parseInt(node.approverRef, 10);
    return userId ? [{ userId, roleId: null }] : [];
  }

  private async createApprovalRecord(
    instanceId: number,
    node: WorkflowNode,
    approver: { userId: number; roleId: number | null },
    createdBy: number
  ): Promise<void> {
    await this.db.insert(workflowApprovals).values({
      tenantId: this.tenantId,
      instanceId,
      nodeId: node.id,
      nodeName: node.name,
      approverId: approver.userId,
      approverRoleId: approver.roleId,
      action: 'PENDING',
      reminderCount: 0,
      createdBy,
    });
  }

  private evaluateCondition(
    condition: { field: string; operator: string; value?: number },
    payload: Record<string, unknown>
  ): boolean {
    if (condition.operator === 'ALWAYS') return true;

    const fieldValue = payload[condition.field] as number | undefined;
    if (fieldValue === undefined || condition.value === undefined) return false;

    switch (condition.operator) {
      case 'GT':
        return fieldValue > condition.value;
      case 'LT':
        return fieldValue < condition.value;
      case 'GTE':
        return fieldValue >= condition.value;
      case 'LTE':
        return fieldValue <= condition.value;
      case 'EQ':
        return fieldValue === condition.value;
      default:
        return false;
    }
  }
}
