-- Backfill for existing tenants: RBAC audit 2026-07-31 (role-defaults.ts vs real route-guard
-- cross-check) found SALES_MANAGER could not reach the CRM Campaign/Segment surface at all,
-- despite already owning every other CRM sub-domain (accounts/leads/tickets/opportunities/
-- journeys/loyalty/referrals/conversations/seasons). Same role-defaults.ts-omission pattern as
-- migration 0076 and others in this file's history — the Campaign Planning migrations
-- (0053-0060) were never followed up with a role-defaults.ts grant. role-defaults.ts only
-- applies at tenant-provisioning time, so tenants provisioned before this fix need these
-- grants inserted directly.
--
-- Deliberately NOT backfilled: CRM_CAMPAIGN_APPROVE / CRM_CAMPAIGN_SEND — treated as
-- intentional segregation-of-duties (creator != approver) for DLT/TRAI-compliance-sensitive
-- bulk customer messaging, not a bug. See role-defaults.ts's inline comment on this grant.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES
    ('CRM_VIEW'),
    ('CRM_SEGMENT_VIEW'),
    ('CRM_SEGMENT_CREATE'),
    ('CRM_CAMPAIGN_CREATE'),
    ('CRM_CAMPAIGN_ANALYTICS_VIEW'),
    ('CRM_INTERACTION_VIEW'),
    ('CRM_INTERACTION_CREATE'),
    ('CRM_AUTOMATION_MANAGE'),
    ('CRM_SENDER_IDENTITY_MANAGE'),
    ('CRM_DLT_TEMPLATE_MANAGE'),
    ('CREDIT_NOTE_ADJUST')
) AS p(permission)
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
