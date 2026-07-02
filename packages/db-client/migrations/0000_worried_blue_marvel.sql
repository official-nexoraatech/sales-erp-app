CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(200) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"flag_key" varchar(200) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_tenant_key" UNIQUE("tenant_id","flag_key")
);
--> statement-breakpoint
CREATE TABLE "inbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"consumer_service" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'PROCESSING' NOT NULL,
	"tenant_id" integer NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_events_idempotency" UNIQUE("event_id","consumer_service")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "saga_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"saga_id" varchar(36) NOT NULL,
	"saga_type" varchar(100) NOT NULL,
	"tenant_id" integer NOT NULL,
	"correlation_id" varchar(36) NOT NULL,
	"status" varchar(20) DEFAULT 'STARTED' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"step_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"permission" varchar(100) NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_unique" UNIQUE("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_unique" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tenant_email" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(20) NOT NULL,
	"address" jsonb,
	"phone" varchar(20),
	"email" varchar(255),
	"gstin" varchar(20),
	"is_head_office" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "branches_tenant_code" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"org_name" varchar(200) NOT NULL,
	"legal_name" varchar(300),
	"gstin" varchar(20),
	"pan" varchar(20),
	"tan" varchar(20),
	"cin" varchar(21),
	"logo_url" text,
	"address" jsonb,
	"timezone" varchar(100) DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" varchar(10) DEFAULT 'INR' NOT NULL,
	"fiscal_year_start" varchar(5) DEFAULT '04-01' NOT NULL,
	"date_format" varchar(20) DEFAULT 'DD/MM/YYYY' NOT NULL,
	"country" varchar(2) DEFAULT 'IN' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"bank_details" jsonb,
	"invoice_footer" text,
	"terms_and_conditions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "org_settings_tenant_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'PROVISIONING' NOT NULL,
	"plan" varchar(50) DEFAULT 'STARTER' NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(20),
	"gstin" varchar(20),
	"pan" varchar(20),
	"registered_address" jsonb,
	"admin_user_id" bigint,
	"s3_prefix" varchar(200),
	"es_index_prefix" varchar(100),
	"provisioning_status" varchar(30) DEFAULT 'NOT_STARTED',
	"provisioning_steps" jsonb DEFAULT '{}'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"suspended_at" timestamp with time zone,
	"suspended_by" integer,
	"suspended_reason" text,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"closed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_contact_email_unique" UNIQUE("contact_email")
);
--> statement-breakpoint
CREATE TABLE "user_branches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_branches_unique" UNIQUE("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"node_id" varchar(50) NOT NULL,
	"node_name" varchar(200) NOT NULL,
	"approver_id" integer NOT NULL,
	"approver_role_id" integer,
	"action" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "wf_approvals_unique" UNIQUE("instance_id","node_id","approver_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"trigger_event" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"condition_expr" jsonb DEFAULT '{"field":"","operator":"ALWAYS"}'::jsonb,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"timeout_hours" integer DEFAULT 48 NOT NULL,
	"escalation_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"current_node_id" varchar(50),
	"correlation_id" varchar(36) NOT NULL,
	"triggered_by_user_id" integer NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"template_id" integer,
	"event_type" varchar(100) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"recipient_user_id" integer,
	"recipient_phone" varchar(20),
	"recipient_email" varchar(255),
	"subject" varchar(500),
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"external_message_id" varchar(200),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notif_pref_unique" UNIQUE("user_id","event_type","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"subject" varchar(500),
	"body_template" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notif_template_unique" UNIQUE("tenant_id","event_type","channel")
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer NOT NULL,
	"s3_key" text NOT NULL,
	"file_name" varchar(300) NOT NULL,
	"file_size_bytes" integer,
	"status" varchar(20) DEFAULT 'GENERATING' NOT NULL,
	"generated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"requested_by" integer NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series_config" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"series_type" varchar(50) NOT NULL,
	"prefix" varchar(20) DEFAULT '' NOT NULL,
	"format_template" varchar(100) NOT NULL,
	"sequence_width" integer DEFAULT 5 NOT NULL,
	"current_seq" integer DEFAULT 0 NOT NULL,
	"financial_year" varchar(10) NOT NULL,
	"last_reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "num_series_unique" UNIQUE("tenant_id","series_type","branch_id","financial_year")
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"format" varchar(10) DEFAULT 'XLSX' NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb,
	"s3_key" text,
	"signed_url" text,
	"signed_url_expires_at" timestamp with time zone,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"requested_by" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
	"s3_key" text NOT NULL,
	"original_file_name" varchar(300) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"success_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb,
	"validation_errors" jsonb DEFAULT '[]'::jsonb,
	"error_report_s3_key" text,
	"rollback_data" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"requested_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"job_name" varchar(200) NOT NULL,
	"cron_expression" varchar(100),
	"status" varchar(20) DEFAULT 'RUNNING' NOT NULL,
	"triggered_by" varchar(20) DEFAULT 'CRON' NOT NULL,
	"triggered_by_user_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"result" jsonb DEFAULT '{}'::jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_configs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"job_name" varchar(200) NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" integer,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sched_job_config_unique" UNIQUE("tenant_id","job_name")
);
--> statement-breakpoint
CREATE TABLE "business_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"event_type" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"condition_operator" varchar(5) DEFAULT 'AND' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "biz_rules_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"customer_code" varchar(50),
	"display_name" varchar(200) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"company_name" varchar(300),
	"customer_type" varchar(20) DEFAULT 'RETAIL' NOT NULL,
	"gstin" text,
	"gstin_hash" varchar(64),
	"pan" text,
	"pan_hash" varchar(64),
	"phone" varchar(20) NOT NULL,
	"alt_phone" varchar(20),
	"email" varchar(255),
	"date_of_birth" varchar(10),
	"anniversary" varchar(10),
	"gender" varchar(10),
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"credit_limit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_limit_enabled" boolean DEFAULT false NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"opening_balance_type" varchar(10) DEFAULT 'DEBIT',
	"price_list_id" bigint,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"loyalty_card_number" varchar(50),
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"blocked_by" integer,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "customers_tenant_code" UNIQUE("tenant_id","customer_code")
);
--> statement-breakpoint
CREATE TABLE "customers_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_data" jsonb NOT NULL,
	"change_type" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"supplier_code" varchar(50),
	"display_name" varchar(200) NOT NULL,
	"company_name" varchar(300),
	"contact_person" varchar(200),
	"supplier_type" varchar(20) DEFAULT 'DOMESTIC' NOT NULL,
	"gstin" varchar(20),
	"pan" varchar(20),
	"phone" varchar(20) NOT NULL,
	"alt_phone" varchar(20),
	"email" varchar(255),
	"billing_address" jsonb,
	"bank_account_no" text,
	"bank_account_no_hash" varchar(64),
	"bank_name" varchar(200),
	"bank_ifsc" varchar(20),
	"bank_branch" varchar(200),
	"credit_days" integer DEFAULT 0 NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"opening_balance_type" varchar(10) DEFAULT 'CREDIT',
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "suppliers_tenant_code" UNIQUE("tenant_id","supplier_code")
);
--> statement-breakpoint
CREATE TABLE "suppliers_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_data" jsonb NOT NULL,
	"change_type" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(20) NOT NULL,
	"address" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "warehouses_tenant_code" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "attribute_sets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attribute_sets_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "attribute_values" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"attribute_id" integer NOT NULL,
	"value" varchar(200) NOT NULL,
	"label" varchar(200) NOT NULL,
	"color_hex" varchar(7),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	CONSTRAINT "attribute_values_tenant_attr_value" UNIQUE("tenant_id","attribute_id","value")
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"attribute_set_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"input_type" varchar(20) DEFAULT 'SELECT' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attributes_tenant_code" UNIQUE("tenant_id","attribute_set_id","code")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(30),
	"logo_url" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brands_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(30),
	"parent_id" integer,
	"description" text,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "item_variants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"sku" varchar(100) NOT NULL,
	"barcode" varchar(100),
	"attribute_combination" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mrp" numeric(15, 2),
	"sale_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"purchase_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "item_variants_tenant_sku" UNIQUE("tenant_id","sku"),
	CONSTRAINT "item_variants_tenant_barcode" UNIQUE("tenant_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_code" varchar(50),
	"name" varchar(300) NOT NULL,
	"description" text,
	"category_id" integer,
	"brand_id" integer,
	"unit_id" integer NOT NULL,
	"attribute_set_id" integer,
	"hsn_code" varchar(20) NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"mrp" numeric(15, 2),
	"sale_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"min_sale_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"purchase_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"barcode" varchar(100),
	"barcode_type" varchar(20) DEFAULT 'EAN13',
	"track_inventory" boolean DEFAULT true NOT NULL,
	"reorder_level" numeric(15, 3) DEFAULT '0' NOT NULL,
	"reorder_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"has_variants" boolean DEFAULT false NOT NULL,
	"variant_attribute_ids" jsonb DEFAULT '[]'::jsonb,
	"image_urls" jsonb DEFAULT '[]'::jsonb,
	"thumbnail_url" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"is_fabric_item" boolean DEFAULT false NOT NULL,
	"fabric_width" numeric(8, 2),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "items_tenant_code" UNIQUE("tenant_id","item_code"),
	CONSTRAINT "items_tenant_barcode" UNIQUE("tenant_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "items_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_data" jsonb NOT NULL,
	"change_type" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"price_list_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"sale_price" numeric(15, 2) NOT NULL,
	"min_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	CONSTRAINT "price_list_items_unique" UNIQUE("price_list_id","item_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(30) NOT NULL,
	"currency" varchar(10) DEFAULT 'INR' NOT NULL,
	"price_includes_tax" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "price_lists_tenant_code" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"abbreviation" varchar(20) NOT NULL,
	"type" varchar(20) DEFAULT 'QUANTITY' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "units_tenant_abbr" UNIQUE("tenant_id","abbreviation")
);
--> statement-breakpoint
CREATE TABLE "gst_rates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"description" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gst_rates_tenant_rate" UNIQUE("tenant_id","rate")
);
--> statement-breakpoint
CREATE TABLE "hsn_master" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"hsn_code" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"chapter" varchar(10),
	"heading" varchar(10),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hsn_master_code" UNIQUE("hsn_code")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"parent_id" integer,
	"account_code" varchar(30) NOT NULL,
	"name" varchar(300) NOT NULL,
	"account_type" varchar(30) NOT NULL,
	"account_sub_type" varchar(50),
	"normal_balance" varchar(10) NOT NULL,
	"is_bank" boolean DEFAULT false NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"opening_balance_type" varchar(10) DEFAULT 'DEBIT' NOT NULL,
	"opening_balance_date" varchar(10),
	"bank_name" varchar(200),
	"bank_account_no" varchar(50),
	"bank_ifsc" varchar(20),
	"bank_branch" varchar(200),
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "accounts_tenant_code" UNIQUE("tenant_id","account_code")
);
--> statement-breakpoint
CREATE TABLE "opening_balances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"balance_type" varchar(10) NOT NULL,
	"as_of_date" varchar(10) NOT NULL,
	"notes" text,
	"quantity" numeric(15, 3),
	"unit_cost" numeric(15, 2),
	"warehouse_id" integer,
	"ledger_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_balances_wizard" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
	"customers_completed" boolean DEFAULT false NOT NULL,
	"suppliers_completed" boolean DEFAULT false NOT NULL,
	"stock_completed" boolean DEFAULT false NOT NULL,
	"accounts_completed" boolean DEFAULT false NOT NULL,
	"cash_bank_completed" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	CONSTRAINT "opening_balances_wizard_tenant" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE INDEX "idx_audit_log_tenant_created" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_feature_flags_tenant" ON "feature_flags" USING btree ("tenant_id","flag_key");--> statement-breakpoint
CREATE INDEX "idx_inbox_status" ON "inbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_unpublished" ON "outbox_events" USING btree ("published","created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_tenant" ON "outbox_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_saga_log_tenant_status" ON "saga_log" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_saga_log_correlation" ON "saga_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_password_reset_user" ON "password_reset_tokens" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens" USING btree ("expires_at","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_role_permissions_role" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_roles_tenant" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_user" ON "user_roles" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_role" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_users_tenant" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_branches_tenant" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_branches_active" ON "branches" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_org_settings_tenant" ON "organization_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenants_status" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tenants_slug" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_user_branches_user" ON "user_branches" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_branches_branch" ON "user_branches" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_wf_approvals_instance" ON "workflow_approvals" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "idx_wf_approvals_approver" ON "workflow_approvals" USING btree ("approver_id","action","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_wf_approvals_tenant_pending" ON "workflow_approvals" USING btree ("tenant_id","action");--> statement-breakpoint
CREATE INDEX "idx_wf_def_tenant_event" ON "workflow_definitions" USING btree ("tenant_id","trigger_event","is_active");--> statement-breakpoint
CREATE INDEX "idx_wf_def_tenant" ON "workflow_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_wf_instance_tenant_status" ON "workflow_instances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_wf_instance_entity" ON "workflow_instances" USING btree ("entity_type","entity_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_wf_instance_expires" ON "workflow_instances" USING btree ("expires_at","status");--> statement-breakpoint
CREATE INDEX "idx_wf_instance_correlation" ON "workflow_instances" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_notif_log_tenant_status" ON "notification_log" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_notif_log_recipient" ON "notification_log" USING btree ("recipient_user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notif_log_event" ON "notification_log" USING btree ("event_type","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notif_pref_user" ON "notification_preferences" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notif_template_tenant_event" ON "notification_templates" USING btree ("tenant_id","event_type","is_active");--> statement-breakpoint
CREATE INDEX "idx_gen_docs_entity" ON "generated_documents" USING btree ("entity_type","entity_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_gen_docs_tenant_type" ON "generated_documents" USING btree ("tenant_id","document_type","status");--> statement-breakpoint
CREATE INDEX "idx_num_series_tenant_type" ON "number_series_config" USING btree ("tenant_id","series_type","financial_year");--> statement-breakpoint
CREATE INDEX "idx_export_jobs_tenant" ON "export_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_export_jobs_requested_by" ON "export_jobs" USING btree ("requested_by","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_import_jobs_tenant" ON "import_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_import_jobs_requested_by" ON "import_jobs" USING btree ("requested_by","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_job_history_tenant_job" ON "job_history" USING btree ("tenant_id","job_name","started_at");--> statement-breakpoint
CREATE INDEX "idx_job_history_status" ON "job_history" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "idx_sched_job_config_tenant" ON "scheduled_job_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_biz_rules_tenant_event" ON "business_rules" USING btree ("tenant_id","event_type","is_active","priority");--> statement-breakpoint
CREATE INDEX "idx_biz_rules_tenant" ON "business_rules" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_customers_tenant" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_branch" ON "customers" USING btree ("branch_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_phone" ON "customers" USING btree ("phone","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_email" ON "customers" USING btree ("email","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_gstin_hash" ON "customers" USING btree ("gstin_hash");--> statement-breakpoint
CREATE INDEX "idx_customers_status" ON "customers" USING btree ("status","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_history_customer" ON "customers_history" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_customers_history_tenant" ON "customers_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_suppliers_tenant" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_branch" ON "suppliers" USING btree ("branch_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_phone" ON "suppliers" USING btree ("phone","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_gstin" ON "suppliers" USING btree ("gstin","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_bank_hash" ON "suppliers" USING btree ("bank_account_no_hash");--> statement-breakpoint
CREATE INDEX "idx_suppliers_status" ON "suppliers" USING btree ("status","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_history_supplier" ON "suppliers_history" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_history_tenant" ON "suppliers_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_warehouses_tenant" ON "warehouses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_warehouses_branch" ON "warehouses" USING btree ("branch_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_warehouses_active" ON "warehouses" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_attribute_sets_tenant" ON "attribute_sets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_attribute_values_attribute" ON "attribute_values" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "idx_attributes_tenant" ON "attributes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_attributes_set" ON "attributes" USING btree ("attribute_set_id");--> statement-breakpoint
CREATE INDEX "idx_brands_tenant" ON "brands" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_categories_tenant" ON "categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_categories_parent" ON "categories" USING btree ("parent_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_item_variants_item" ON "item_variants" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_item_variants_barcode" ON "item_variants" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_items_tenant" ON "items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_items_category" ON "items" USING btree ("category_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_items_brand" ON "items" USING btree ("brand_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_items_barcode" ON "items" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_items_hsn" ON "items" USING btree ("hsn_code","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_items_status" ON "items" USING btree ("status","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_items_history_item" ON "items_history" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_items_history_tenant" ON "items_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_price_list_items_list" ON "price_list_items" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "idx_price_list_items_item" ON "price_list_items" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_price_lists_tenant" ON "price_lists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_units_tenant" ON "units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_gst_rates_tenant" ON "gst_rates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_hsn_master_code" ON "hsn_master" USING btree ("hsn_code");--> statement-breakpoint
CREATE INDEX "idx_hsn_master_chapter" ON "hsn_master" USING btree ("chapter");--> statement-breakpoint
CREATE INDEX "idx_accounts_tenant" ON "accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_parent" ON "accounts" USING btree ("parent_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_type" ON "accounts" USING btree ("account_type","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_opening_balances_tenant" ON "opening_balances" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE INDEX "idx_opening_balances_entity" ON "opening_balances" USING btree ("entity_type","entity_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ob_wizard_tenant" ON "opening_balances_wizard" USING btree ("tenant_id");