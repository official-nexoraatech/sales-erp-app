-- Lead capture from the public marketing site (landing-page Hero "Book a Demo" form and the
-- /contact "Talk to Sales" form) — global (no tenant_id), this is pre-tenant prospect data.
-- Most fields are nullable because the two forms collect different subsets: the Hero form
-- requires name/email/phone/company, /contact requires name/email/company/message.
CREATE TABLE IF NOT EXISTS "demo_requests" (
  "id" bigserial PRIMARY KEY,
  "full_name" varchar(200) NOT NULL,
  "email" varchar(255) NOT NULL,
  "country_code" varchar(5),
  "phone" varchar(20),
  "company" varchar(200),
  "city" varchar(100),
  "designation" varchar(100),
  "product_type" varchar(20),
  "message" text,
  "source" varchar(20) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_demo_requests_created_at" ON "demo_requests"("created_at");
