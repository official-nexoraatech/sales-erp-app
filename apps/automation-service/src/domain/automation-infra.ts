import { and, eq } from 'drizzle-orm';
import { roles, userRoles, users, outboxEvents } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ulid } from 'ulid';
import type { ActionPublisher, NotificationDispatcher } from './WorkflowExecutionEngine.js';

const logger = createLogger({ serviceName: 'automation-service' });

// Same role->user(s) resolution + internal-API delivery pattern as
// WorkflowEngine.resolveApprovers and scheduler-service's workflow.approval-reminder job —
// reused here rather than reimplemented, per the "one notification path" convention.
export class HttpNotificationDispatcher implements NotificationDispatcher {
  constructor(private readonly db: ErpDatabase) {}

  async notifyRole(tenantId: number, roleName: string, message: string): Promise<void> {
    const [role] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, roleName), eq(roles.tenantId, tenantId)));
    if (!role) return;

    const eligible = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(userRoles.roleId, role.id),
          eq(userRoles.tenantId, tenantId),
          eq(users.isActive, true)
        )
      );

    for (const u of eligible) {
      await this.notifyUser(tenantId, u.userId, message);
    }
  }

  async notifyUser(tenantId: number, userId: number, message: string): Promise<void> {
    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
    const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
    try {
      const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        body: JSON.stringify({
          tenantId,
          eventType: 'WORKFLOW_AUTOMATION_NOTIFICATION',
          channel: 'IN_APP',
          recipientUserId: userId,
          body: message,
        }),
      });
      if (!res.ok) {
        logger.warn(
          { tenantId, userId, status: res.status },
          'Automation notification delivery failed'
        );
      }
    } catch (err) {
      logger.warn({ tenantId, userId, err }, 'Automation notification delivery failed (non-fatal)');
    }
  }
}

// Publishes to the existing outbox table — never a direct write to another domain's tables
// (the plan's Section 6.4 guardrail). Consuming services subscribe to the resulting Kafka
// topic (erp.<event.type>) exactly like every other outbox-driven integration in this codebase.
export class OutboxActionPublisher implements ActionPublisher {
  constructor(private readonly db: ErpDatabase) {}

  async publish(
    tenantId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType,
      aggregateType: 'WorkflowAutomation',
      aggregateId: 0,
      tenantId,
      payload,
      published: false,
    });
  }
}
