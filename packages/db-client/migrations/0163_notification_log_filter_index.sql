-- Notification Center audit finding: the view-all page's category/unread-only filters had no
-- supporting index, falling back to scanning every row matching (recipient_user_id, tenant_id)
-- and filtering the rest in Postgres. Covers the two highest-traffic query shapes (list +
-- unread-only) added this session.
CREATE INDEX "idx_notif_log_recipient_unread" ON "notification_log" ("recipient_user_id", "tenant_id", "channel", "read_at");
