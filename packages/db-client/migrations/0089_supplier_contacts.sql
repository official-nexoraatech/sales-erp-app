-- Purchase module enhancement 2026-07-21: suppliers only ever had one free-text
-- `contact_person` field — no way to record more than one real point of contact
-- (e.g. a sales rep vs an accounts/finance contact for the same supplier).
CREATE TABLE IF NOT EXISTS "supplier_contacts" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "designation" varchar(100),
  "phone" varchar(20),
  "email" varchar(255),
  "is_primary" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_supplier_contacts_supplier" ON "supplier_contacts" ("supplier_id", "tenant_id");
