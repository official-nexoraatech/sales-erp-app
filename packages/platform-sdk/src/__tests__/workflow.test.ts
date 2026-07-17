// PG-026 follow-up fix, 2026-07-17: WorkflowEngine.resolveApprover used to return a ROLE's own
// id as if it were a user id, so getPendingForApprover(userId) could never match a real row for
// any ROLE-type approval node (18 of 19 SYSTEM_WORKFLOW_DEFINITIONS use approverType: 'ROLE').
// This suite exercises the fixed role->user(s) resolution end-to-end against a real database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  tenants,
  roles,
  users,
  userRoles,
  workflowDefinitions,
  workflowInstances,
  workflowApprovals,
  type WorkflowNode,
} from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { WorkflowEngine } from '../workflow.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('WorkflowEngine — role approver resolution', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let tenantId: number;
  let roleId: number;
  let activeUser1: number;
  let activeUser2: number;
  let inactiveUser: number;
  const cleanupInstanceIds: number[] = [];
  const cleanupDefinitionIds: number[] = [];

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const suffix = Date.now();
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `Workflow Test Tenant ${suffix}`,
        slug: `workflow-test-${suffix}`,
        status: 'ACTIVE',
        contactEmail: `workflow-test-${suffix}@example.com`,
      })
      .returning();
    tenantId = tenant!.id;

    const [role] = await db
      .insert(roles)
      .values({
        tenantId,
        name: 'TEST_APPROVER_ROLE',
        description: 'Workflow test role',
        isSystem: false,
      })
      .returning();
    roleId = role!.id;

    async function makeUser(email: string, isActive: boolean): Promise<number> {
      const [user] = await db
        .insert(users)
        .values({
          tenantId,
          email,
          passwordHash: 'x',
          firstName: 'Test',
          lastName: 'Approver',
          isActive,
          isEmailVerified: true,
        })
        .returning();
      return user!.id;
    }

    activeUser1 = await makeUser(`wf-active1-${suffix}@example.com`, true);
    activeUser2 = await makeUser(`wf-active2-${suffix}@example.com`, true);
    inactiveUser = await makeUser(`wf-inactive-${suffix}@example.com`, false);

    await db.insert(userRoles).values([
      { userId: activeUser1, roleId, tenantId },
      { userId: activeUser2, roleId, tenantId },
      { userId: inactiveUser, roleId, tenantId },
    ]);
  });

  afterAll(async () => {
    if (cleanupInstanceIds.length) {
      await db
        .delete(workflowApprovals)
        .where(inArray(workflowApprovals.instanceId, cleanupInstanceIds));
      await db.delete(workflowInstances).where(inArray(workflowInstances.id, cleanupInstanceIds));
    }
    if (cleanupDefinitionIds.length) {
      await db
        .delete(workflowDefinitions)
        .where(inArray(workflowDefinitions.id, cleanupDefinitionIds));
    }
    await db.delete(userRoles).where(eq(userRoles.tenantId, tenantId));
    await db.delete(users).where(inArray(users.id, [activeUser1, activeUser2, inactiveUser]));
    await db.delete(roles).where(eq(roles.id, roleId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  async function seedDefinition(nodes: WorkflowNode[], triggerEvent: string): Promise<number> {
    const [def] = await db
      .insert(workflowDefinitions)
      .values({
        tenantId,
        name: `Test — ${triggerEvent}`,
        triggerEvent,
        entityType: 'TestEntity',
        conditionExpr: { field: '', operator: 'ALWAYS' },
        nodes,
        timeoutHours: 24,
        isSystem: false,
        isActive: true,
        createdBy: 0,
      })
      .returning();
    cleanupDefinitionIds.push(def!.id);
    return def!.id;
  }

  it('creates one approval row per active user holding the role, skipping inactive users', async () => {
    const triggerEvent = `TEST_SINGLE_${randomUUID()}`;
    await seedDefinition(
      [
        {
          id: 'node_1',
          name: 'Approver',
          type: 'APPROVAL',
          approverType: 'ROLE',
          approverRef: 'TEST_APPROVER_ROLE',
        },
      ],
      triggerEvent
    );

    const engine = new WorkflowEngine(db, tenantId, activeUser1, randomUUID());
    const instance = await engine.trigger({
      event: triggerEvent,
      entityType: 'TestEntity',
      entityId: 1,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    expect(instance).not.toBeNull();
    cleanupInstanceIds.push(instance!.id);

    const rows = await db
      .select()
      .from(workflowApprovals)
      .where(eq(workflowApprovals.instanceId, instance!.id));
    const approverIds = rows.map((r) => r.approverId).sort();
    expect(approverIds).toEqual([activeUser1, activeUser2].sort());
    expect(rows.every((r) => r.approverRoleId === roleId)).toBe(true);

    // The previous bug stored the role's own id as approverId, so this lookup could never match.
    const pendingForUser1 = await engine.getPendingForApprover(activeUser1);
    expect(pendingForUser1).toHaveLength(1);
    expect(pendingForUser1[0]!.instanceId).toBe(instance!.id);

    const pendingForInactiveUser = await engine.getPendingForApprover(inactiveUser);
    expect(pendingForInactiveUser).toHaveLength(0);
  });

  it('default (single-decision) semantics: one approver deciding finalizes the instance and clears the other pending row', async () => {
    const triggerEvent = `TEST_SINGLE_DECIDES_${randomUUID()}`;
    await seedDefinition(
      [
        {
          id: 'node_1',
          name: 'Approver',
          type: 'APPROVAL',
          approverType: 'ROLE',
          approverRef: 'TEST_APPROVER_ROLE',
        },
      ],
      triggerEvent
    );

    const engine = new WorkflowEngine(db, tenantId, activeUser1, randomUUID());
    const instance = await engine.trigger({
      event: triggerEvent,
      entityType: 'TestEntity',
      entityId: 2,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    cleanupInstanceIds.push(instance!.id);

    await engine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: activeUser1 });

    const status = await engine.getStatus(instance!.id);
    expect(status.status).toBe('APPROVED');

    // user2's row is still physically PENDING in the DB, but must no longer surface as
    // actionable once the instance has moved past this node.
    const pendingForUser2 = await engine.getPendingForApprover(activeUser2);
    expect(pendingForUser2.some((p) => p.instanceId === instance!.id)).toBe(false);
  });

  it('requireAllApprovers: true waits for every eligible approver before advancing', async () => {
    const triggerEvent = `TEST_REQUIRE_ALL_${randomUUID()}`;
    await seedDefinition(
      [
        {
          id: 'node_1',
          name: 'All Approvers',
          type: 'PARALLEL_APPROVAL',
          approverType: 'ROLE',
          approverRef: 'TEST_APPROVER_ROLE',
          requireAllApprovers: true,
        },
      ],
      triggerEvent
    );

    const engine = new WorkflowEngine(db, tenantId, activeUser1, randomUUID());
    const instance = await engine.trigger({
      event: triggerEvent,
      entityType: 'TestEntity',
      entityId: 3,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    cleanupInstanceIds.push(instance!.id);

    await engine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: activeUser1 });
    let status = await engine.getStatus(instance!.id);
    expect(status.status).toBe('PENDING');

    await engine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: activeUser2 });
    status = await engine.getStatus(instance!.id);
    expect(status.status).toBe('APPROVED');
  });
});
