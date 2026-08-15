-- Dual-sidebar personalization: users had no per-user UI-preference storage at all (theme
-- mode/density/collapsed-state were localStorage-only). Nullable jsonb keeps this backward
-- compatible — existing rows get NULL, read as "no preference" (sidebarStyle defaults to
-- 'modern' in application code, never here).
ALTER TABLE "users" ADD COLUMN "preferences" jsonb;
