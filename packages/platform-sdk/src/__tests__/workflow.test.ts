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
  let outsiderUser: number;
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
    // Deliberately not assigned TEST_APPROVER_ROLE — used to prove a non-approver can't
    // force-decide someone else's pending approval (see the NOT_ELIGIBLE_APPROVER test below).
    outsiderUser = await makeUser(`wf-outsider-${suffix}@example.com`, true);

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
    await db
      .delete(users)
      .where(inArray(users.id, [activeUser1, activeUser2, inactiveUser, outsiderUser]));
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

  // Multi-vertical platform audit 2026-08-16: evaluateCondition() now delegates to
  // rule-engine.ts's canonical evaluator instead of its own GT/LT/GTE/LTE/EQ/ALWAYS-only DSL.
  // Every SYSTEM_WORKFLOW_DEFINITIONS entry that isn't ALWAYS uses the legacy 'GT' operator
  // (e.g. { field: 'grandTotal', operator: 'GT', value: 50000 }) — this is a regression guard
  // that the legacy short-form operator still evaluates identically through the shared engine.
  it('legacy GT conditionExpr operator still gates triggering correctly through the shared rule-engine evaluator', async () => {
    const triggerEvent = `TEST_GT_${randomUUID()}`;
    const [def] = await db
      .insert(workflowDefinitions)
      .values({
        tenantId,
        name: `Test — ${triggerEvent}`,
        triggerEvent,
        entityType: 'TestEntity',
        conditionExpr: { field: 'grandTotal', operator: 'GT', value: 50000 },
        nodes: [
          {
            id: 'node_1',
            name: 'Approver',
            type: 'APPROVAL',
            approverType: 'ROLE',
            approverRef: 'TEST_APPROVER_ROLE',
          },
        ] satisfies WorkflowNode[],
        timeoutHours: 24,
        isSystem: false,
        isActive: true,
        createdBy: 0,
      })
      .returning();
    cleanupDefinitionIds.push(def!.id);

    const engine = new WorkflowEngine(db, tenantId, activeUser1, randomUUID());

    const belowThreshold = await engine.trigger({
      event: triggerEvent,
      entityType: 'TestEntity',
      entityId: 101,
      userId: activeUser1,
      correlationId: randomUUID(),
      payload: { grandTotal: 40000 },
    });
    expect(belowThreshold).toBeNull();

    const aboveThreshold = await engine.trigger({
      event: triggerEvent,
      entityType: 'TestEntity',
      entityId: 102,
      userId: activeUser1,
      correlationId: randomUUID(),
      payload: { grandTotal: 60000 },
    });
    expect(aboveThreshold).not.toBeNull();
    cleanupInstanceIds.push(aboveThreshold!.id);
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

  it('rejects approve()/reject() from a user who is not an eligible pending approver for the node', async () => {
    const triggerEvent = `TEST_NOT_ELIGIBLE_${randomUUID()}`;
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
      entityId: 4,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    cleanupInstanceIds.push(instance!.id);

    // outsiderUser holds no role on this workflow and has no approval row at all — must not
    // be able to force-approve or force-reject someone else's pending decision.
    const outsiderEngine = new WorkflowEngine(db, tenantId, outsiderUser, randomUUID());
    await expect(
      outsiderEngine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: outsiderUser })
    ).rejects.toThrow('not an eligible, pending approver');
    await expect(
      outsiderEngine.reject({
        instanceId: instance!.id,
        nodeId: 'node_1',
        userId: outsiderUser,
        comment: 'nope',
      })
    ).rejects.toThrow('not an eligible, pending approver');

    // Instance must remain untouched — still pending, still awaiting a real approver.
    const status = await engine.getStatus(instance!.id);
    expect(status.status).toBe('PENDING');

    // The real approver can still act normally afterward.
    await engine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: activeUser1 });
    const finalStatus = await engine.getStatus(instance!.id);
    expect(finalStatus.status).toBe('APPROVED');
  });

  // Notification Center: WorkflowEngine previously never notified anyone — approvers only
  // discovered a pending item by polling My Approvals, and a requester never learned the
  // outcome. Only the outbound fetch (an external HTTP boundary) is mocked here; everything
  // else runs against the real database, same as the rest of this suite.
  it('notifies each resolved approver on trigger(), and the requester once the decision finalizes', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const triggerEvent = `TEST_NOTIFY_${randomUUID()}`;
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
      entityId: 99,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    cleanupInstanceIds.push(instance!.id);

    // notifyUser is fire-and-forget (`void this.notifyUser(...)`) — give its promise a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const approvalCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/notifications/send-raw-internal')
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(2); // one per active role-holder
    const firstBody = JSON.parse(String(approvalCalls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(firstBody).toMatchObject({
      channel: 'IN_APP',
      entityType: 'TestEntity',
      entityId: 99,
      businessCategory: 'APPROVAL',
      priority: 'HIGH',
      metadata: { instanceId: instance!.id, nodeId: 'node_1' },
    });

    fetchSpy.mockClear();
    await engine.approve({ instanceId: instance!.id, nodeId: 'node_1', userId: activeUser1 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const outcomeCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/notifications/send-raw-internal')
    );
    expect(outcomeCalls.length).toBeGreaterThanOrEqual(1);
    const outcomeBody = JSON.parse(String(outcomeCalls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(outcomeBody['recipientUserId']).toBe(activeUser1);
    expect(String(outcomeBody['subject'])).toContain('approved');

    fetchSpy.mockRestore();
  });

  // Audit follow-up: notifyUser was pure fire-and-forget with no retry — a single transient
  // notification-service hiccup silently dropped the notification forever. This proves the
  // retry actually delivers on the second attempt rather than giving up after the first.
  it('retries once on a transient notification-service failure and still delivers', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const triggerEvent = `TEST_RETRY_${randomUUID()}`;
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
      entityId: 77,
      userId: activeUser1,
      correlationId: randomUUID(),
    });
    cleanupInstanceIds.push(instance!.id);

    // notifyUser is fire-and-forget; the retry itself waits ~400ms before its second attempt.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const calls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/notifications/send-raw-internal')
    );
    // The mocked 503 only fires on the very first fetch overall, so exactly one of the 2
    // active role-holders' notifications needed a retry — 3 calls total (1 failed + 1 retry-
    // success for the first approver, 1 immediate success for the second), not 2. More than
    // one call per approver is exactly the signal that a retry actually fired, not just that
    // both approvers happened to get notified.
    expect(calls.length).toBe(3);

    fetchSpy.mockRestore();
  });
});
