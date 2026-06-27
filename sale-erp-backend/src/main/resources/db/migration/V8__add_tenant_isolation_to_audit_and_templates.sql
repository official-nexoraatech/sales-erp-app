ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

UPDATE audit_logs
SET organization_id = COALESCE(
    organization_id,
    (
        SELECT u.organization_id
        FROM users u
        WHERE u.id = audit_logs.user_id
        LIMIT 1
    ),
    (
        SELECT o.id
        FROM organizations o
        ORDER BY o.id
        LIMIT 1
    )
)
WHERE organization_id IS NULL;

ALTER TABLE audit_logs
    ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE audit_logs
    ADD CONSTRAINT fk_audit_logs_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id ON audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_created_at ON audit_logs (organization_id, created_at);

ALTER TABLE sms_templates
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

UPDATE sms_templates
SET organization_id = COALESCE(
    organization_id,
    (
        SELECT o.id
        FROM organizations o
        ORDER BY o.id
        LIMIT 1
    )
)
WHERE organization_id IS NULL;

ALTER TABLE sms_templates
    ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE sms_templates
    ADD CONSTRAINT fk_sms_templates_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id);

CREATE INDEX IF NOT EXISTS idx_sms_templates_organization_id ON sms_templates (organization_id);
CREATE INDEX IF NOT EXISTS idx_sms_templates_org_name ON sms_templates (organization_id, lower(name));

ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

UPDATE email_templates
SET organization_id = COALESCE(
    organization_id,
    (
        SELECT o.id
        FROM organizations o
        ORDER BY o.id
        LIMIT 1
    )
)
WHERE organization_id IS NULL;

ALTER TABLE email_templates
    ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE email_templates
    ADD CONSTRAINT fk_email_templates_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id);

CREATE INDEX IF NOT EXISTS idx_email_templates_organization_id ON email_templates (organization_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_org_name ON email_templates (organization_id, lower(name));
