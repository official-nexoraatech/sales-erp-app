-- Backfill notification_templates for existing tenants.
--
-- Root cause: apps/notification-service/src/api/notification.routes.ts defines
-- POST /notifications/templates/seed-auth (PASSWORD_RESET_REQUESTED), seed-crm
-- (BIRTHDAY_GREETING x2), and seed-hr (ALTERATION_READY, ALTERATION_ASSIGNED) — all three
-- fully correct, but NEVER CALLED from anywhere. Only seed-tenant (WELCOME_EMAIL) is wired
-- into TenantProvisioner's provisioning flow (see PG-026's fix). Since every notification
-- send in this codebase is deliberately fire-and-forget, NotificationEngine's
-- no-template-row-found path silently "SKIPPED" every one of these event types for every
-- tenant, for the system's entire history — including password-reset emails. Found during
-- the 2026-07-16 gateway-cutover audit. TenantProvisioner now also calls seed-auth/seed-crm/
-- seed-hr for newly-provisioned tenants; this migration backfills existing ones with the
-- exact same template content those endpoints insert.
INSERT INTO "notification_templates"
  ("tenant_id", "name", "event_type", "channel", "subject", "body_template", "is_system", "created_by")
SELECT
  t.id, v.name, v.event_type, v.channel, v.subject, v.body_template, true, 0
FROM "tenants" t
CROSS JOIN (VALUES
  ('Password Reset', 'PASSWORD_RESET_REQUESTED', 'EMAIL', 'Reset your password',
   '<p>We received a request to reset your password.</p><p><a href="{{resetLink}}">Click here to reset your password</a></p><p>If you did not request this, you can safely ignore this email.</p>'),
  ('Birthday Greeting (WhatsApp)', 'BIRTHDAY_GREETING', 'WHATSAPP', NULL,
   'Happy Birthday {{customerName}}! 🎉 {{shopName}} wishes you a wonderful year ahead. Visit us for a special birthday surprise!'),
  ('Birthday Greeting (SMS fallback)', 'BIRTHDAY_GREETING', 'SMS', NULL,
   'Happy Birthday {{customerName}}! {{shopName}} wishes you a great year. Visit us for a special offer.'),
  ('Alteration Ready', 'ALTERATION_READY', 'WHATSAPP', NULL,
   'Hi {{customerName}}, your alteration is ready. Ref: {{orderNumber}}'),
  ('Alteration Assigned', 'ALTERATION_ASSIGNED', 'IN_APP', NULL,
   'You have been assigned alteration order {{orderNumber}}')
) AS v(name, event_type, channel, subject, body_template)
ON CONFLICT ON CONSTRAINT "notif_template_unique" DO NOTHING;
