-- POS hold/resume sale — lets a cashier park an in-progress cart and pick it back up
-- later (or on another till in the same session) instead of losing it.

CREATE TABLE IF NOT EXISTS "pos_held_sales" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "session_id" integer NOT NULL,
  "customer_id" integer,
  "label" varchar(100),
  "cart" jsonb NOT NULL,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pos_held_sales_tenant_session" ON "pos_held_sales" ("tenant_id", "session_id");
