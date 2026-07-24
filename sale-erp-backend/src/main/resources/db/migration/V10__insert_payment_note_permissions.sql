-- ===================== PAYMENT NOTE =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('PAYMENT_NOTE_CREATE', 'Payment Note', 'Create a new payment note', 'POST /api/v1/payment-notes', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_NOTE_VIEW', 'Payment Note', 'View payment notes list and detail', 'GET /api/v1/payment-notes, GET /api/v1/payment-notes/{id}, GET /api/v1/payment-notes/{id}/audit', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_NOTE_UPDATE', 'Payment Note', 'Update a payment note, its status, or assignment', 'PUT /api/v1/payment-notes/{id}, PUT /api/v1/payment-notes/{id}/status, PUT /api/v1/payment-notes/{id}/assign', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_NOTE_DELETE', 'Payment Note', 'Delete a payment note', 'DELETE /api/v1/payment-notes/{id}', 'ACTIVE', FALSE, NOW(), NOW());
