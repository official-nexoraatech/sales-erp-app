import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Notification Templates (per tenant, per event type) ──────────────────
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>(),
    subject: varchar('subject', { length: 500 }),
    bodyTemplate: text('body_template').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    variables: jsonb('variables').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('notif_template_unique').on(t.tenantId, t.eventType, t.channel),
    index('idx_notif_template_tenant_event').on(t.tenantId, t.eventType, t.isActive),
  ]
);

// ─── Notification Log (delivery audit) ───────────────────────────────────
export const notificationLog = pgTable(
  'notification_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    templateId: integer('template_id'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>(),
    recipientUserId: integer('recipient_user_id'),
    recipientPhone: varchar('recipient_phone', { length: 20 }),
    recipientEmail: varchar('recipient_email', { length: 255 }),
    subject: varchar('subject', { length: 500 }),
    body: text('body').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED'>(),
    externalMessageId: varchar('external_message_id', { length: 200 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    // ES-26 (M8): caller-supplied or derived dedup key (tenant+eventType+channel+recipient+
    // templateData hash + 5-min time bucket) — a unique index on (tenantId, idempotencyKey)
    // rejects a retry that lands on an already-recently-sent notification.
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_notif_log_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_notif_log_recipient').on(t.recipientUserId, t.tenantId),
    index('idx_notif_log_event').on(t.eventType, t.tenantId),
    unique('notif_log_idempotency_key').on(t.tenantId, t.idempotencyKey),
  ]
);

// ─── Delivery-webhook idempotency (CP-6) ───────────────────────────────────
// Source-level dedup for provider delivery-status webhooks (MSG91/SendGrid/Meta) — a provider
// redelivering the same event must not double-process. Enforced via
// INSERT ... ON CONFLICT (provider, provider_event_id) DO NOTHING at the application layer.
export const notificationDeliveryEvents = pgTable(
  'notification_delivery_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    notificationLogId: integer('notification_log_id').notNull(),
    provider: varchar('provider', { length: 20 }).notNull().$type<'MSG91' | 'SENDGRID' | 'META'>(),
    providerEventId: varchar('provider_event_id', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 30 }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('notification_delivery_events_dedup').on(t.provider, t.providerEventId),
    index('idx_notification_delivery_events_log').on(t.notificationLogId),
  ]
);

// ─── Per-user notification preferences ────────────────────────────────────
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    smsEnabled: boolean('sms_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('notif_pref_unique').on(t.userId, t.eventType, t.tenantId),
    index('idx_notif_pref_user').on(t.userId, t.tenantId),
  ]
);

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;
export type NotificationLogEntry = typeof notificationLog.$inferSelect;
export type NewNotificationLogEntry = typeof notificationLog.$inferInsert;
export type NotificationDeliveryEvent = typeof notificationDeliveryEvents.$inferSelect;
export type NewNotificationDeliveryEvent = typeof notificationDeliveryEvents.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
