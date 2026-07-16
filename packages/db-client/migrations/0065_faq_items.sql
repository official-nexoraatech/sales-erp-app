-- Public marketing FAQ content, replacing the hardcoded array in FAQSection.tsx. Global
-- (no tenant_id) — this is platform marketing content, not per-tenant configuration.
CREATE TABLE IF NOT EXISTS "faq_items" (
  "id" bigserial PRIMARY KEY,
  "category" varchar(100) NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_published" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 0,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_faq_items_published_sort" ON "faq_items"("is_published", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_faq_items_category" ON "faq_items"("category", "sort_order");
--> statement-breakpoint

-- Seed content, grounded in verified real product behavior (not invented) — createdBy=0
-- is the same "system-authored" sentinel TenantProvisioner uses for seed data.
INSERT INTO "faq_items" ("category", "question", "answer", "sort_order", "created_by") VALUES
('Getting Started', 'Can I try NEXORAA ERP before committing?', 'Yes — Start Free Trial creates your own workspace instantly on the Starter plan, with no payment details required.', 0, 0),
('Getting Started', 'Can I run multiple branches or locations from one account?', 'Yes. Growth and Enterprise plans support multi-branch operations, with stock, sales and accounting scoped per branch but rolled up into shared reporting.', 1, 0),
('Security & Data', 'How does tenant data isolation work?', 'Every tenant''s data is scoped by tenant ID at the database layer and enforced on every request through role-based access control — one tenant can never query another tenant''s records.', 0, 0),
('Security & Data', 'Is my data encrypted?', 'All traffic is served over HTTPS/TLS. Sensitive configuration values, such as SSO client secrets, are encrypted at rest.', 1, 0),
('Security & Data', 'How is access controlled within my organization?', 'Through granular role-based access control — 285 distinct permissions across every module, not just a handful of fixed roles — so you can grant exactly the access each team member needs.', 2, 0),
('Security & Data', 'Can support staff access my account?', 'Only through a time-boxed, fully audit-logged impersonation session that your administrators can review in the security audit log — never silently.', 3, 0),
('Compliance', 'Does NEXORAA handle GST compliance?', 'Yes — GSTR-1, GSTR-3B, GSTR-9 return data, e-Invoice and e-Way Bill generation, and GSTR-2A reconciliation are generated directly from your transactions. You review and file; we handle the assembly.', 0, 0),
('Compliance', 'Can I connect NEXORAA to other tools I already use?', 'Yes, via HMAC-signed outbound webhooks on key events like invoice creation and payment receipt — configurable per tenant from Settings once you''re signed in.', 1, 0),
('Plans & Billing', 'What happens if my team outgrows my current plan?', 'Reach out via the Contact page — plan changes are handled by our team today rather than a self-service toggle, so we can make sure your data and user limits move over correctly.', 0, 0),
('Plans & Billing', 'Can I enable only the modules I need?', 'Every plan includes a defined set of modules and capabilities out of the box (see the Pricing comparison table); which specific features are switched on for your tenant is managed through your plan and account settings.', 1, 0),
('Plans & Billing', 'What happens to my data if I cancel?', 'You retain ownership of your data. Contact our team via the Contact page to discuss export and account closure.', 2, 0)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant the new PLATFORM_CONTENT_MANAGE permission to the reserved platform-operator role
-- (see 0020_es21_platform_operator.sql) — this is platform marketing content, managed the
-- same way tenant lifecycle is: by the platform team, not any customer tenant's own role.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r."id", 'PLATFORM_CONTENT_MANAGE', r."tenant_id"
FROM "roles" r
JOIN "tenants" t ON t."id" = r."tenant_id"
WHERE t."slug" = 'platform-operations' AND r."name" = 'PLATFORM_OPERATOR'
ON CONFLICT ("role_id", "permission") DO NOTHING;
