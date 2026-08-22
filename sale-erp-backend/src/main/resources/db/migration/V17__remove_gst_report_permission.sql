-- =====================================================
-- Remove GST / GSTR-1 / GSTR-2 Reports
-- These reports are not required by Texmitra and their
-- endpoint and permission have been removed from the app.
-- =====================================================
DELETE FROM role_permission_mapping
WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'REPORT_GST_VIEW');

DELETE FROM user_permission_mapping
WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'REPORT_GST_VIEW');

DELETE FROM permissions WHERE name = 'REPORT_GST_VIEW';
