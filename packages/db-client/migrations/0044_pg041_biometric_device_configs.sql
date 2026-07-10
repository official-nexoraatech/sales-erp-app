-- PG-041: biometric attendance import — one device-export column-mapping config per
-- tenant (v1). No FK on tenant_id per this repo's no-FK, app-enforced-isolation convention.
CREATE TABLE IF NOT EXISTS "biometric_device_configs" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "vendor" varchar(20) NOT NULL DEFAULT 'GENERIC_CSV',
  "column_mapping" jsonb NOT NULL,
  "date_format" varchar(20) NOT NULL DEFAULT 'YYYY-MM-DD',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "biometric_device_configs_tenant_unique" UNIQUE ("tenant_id")
);
