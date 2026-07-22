-- ===================== BRANCH MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('BRANCH_CREATE', 'Branch', 'Create a new branch', 'POST /api/v1/branches', 'ACTIVE', FALSE, NOW(), NOW()),
('BRANCH_VIEW', 'Branch', 'View branches list', 'GET /api/v1/branches, GET /api/v1/branches/{id}, GET /api/v1/branches/organization/{organizationId}', 'ACTIVE', FALSE, NOW(), NOW()),
('BRANCH_UPDATE', 'Branch', 'Update an existing branch', 'PUT /api/v1/branches/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('BRANCH_DELETE', 'Branch', 'Delete a branch', 'DELETE /api/v1/branches/{id}', 'ACTIVE', FALSE, NOW(), NOW());
