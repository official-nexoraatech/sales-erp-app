-- Notification Center: notification_log had no way to say which ERP record a notification
-- refers to, so clicking one could never navigate anywhere. All columns nullable — existing
-- rows and non-IN_APP channels (SMS/EMAIL/WHATSAPP/INSTAGRAM) simply leave them unset.
ALTER TABLE "notification_log" ADD COLUMN "entity_type" varchar(50);
ALTER TABLE "notification_log" ADD COLUMN "entity_id" integer;
ALTER TABLE "notification_log" ADD COLUMN "priority" varchar(10);
ALTER TABLE "notification_log" ADD COLUMN "business_category" varchar(30);
