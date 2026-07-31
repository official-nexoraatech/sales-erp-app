-- M-14 fix: customer search (GET /customers?search=) ORs ilike('%...%') across display_name,
-- phone, email, and customer_code (customer.routes.ts), but only display_name/company_name
-- had a trigram GIN index (migration 0007) — phone/email/customer_code likely forced a
-- sequential scan on customers for tenants with large customer bases.

CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON customers USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_code_trgm
  ON customers USING gin (customer_code gin_trgm_ops);
