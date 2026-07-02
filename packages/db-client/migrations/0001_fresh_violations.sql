CREATE TABLE "fabric_cuts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"roll_id" integer NOT NULL,
	"meters" numeric(10, 2) NOT NULL,
	"meters_before_cut" numeric(10, 2) NOT NULL,
	"meters_after_cut" numeric(10, 2) NOT NULL,
	"purpose" varchar(100),
	"reference_type" varchar(50),
	"reference_id" integer,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fabric_rolls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"roll_number" varchar(50) NOT NULL,
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"grn_reference" varchar(50),
	"original_meters" numeric(10, 2) NOT NULL,
	"remaining_meters" numeric(10, 2) NOT NULL,
	"width" numeric(8, 2),
	"status" varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fabric_rolls_tenant_number" UNIQUE("tenant_id","roll_number")
);
--> statement-breakpoint
CREATE TABLE "inventory_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"warehouse_id" integer NOT NULL,
	"movement_type" varchar(30) NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"quantity_before" numeric(15, 3) NOT NULL,
	"quantity_after" numeric(15, 3) NOT NULL,
	"reference_type" varchar(50),
	"reference_id" integer,
	"reference_line_id" integer,
	"unit_cost" numeric(15, 2),
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_verification_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"verification_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"system_qty" numeric(15, 3) NOT NULL,
	"physical_qty" numeric(15, 3),
	"variance" numeric(15, 3),
	"is_reviewed" boolean DEFAULT false NOT NULL,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pvl_unique" UNIQUE("verification_id","item_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "physical_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"verification_number" varchar(30) NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"snapshot_taken_at" timestamp with time zone,
	"counting_started_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" integer,
	"adjustment_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "phys_verif_tenant_number" UNIQUE("tenant_id","verification_number")
);
--> statement-breakpoint
CREATE TABLE "projection_stock_level" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"warehouse_id" integer NOT NULL,
	"available_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"last_movement_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proj_stock_unique" UNIQUE("tenant_id","item_id","warehouse_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"ledger_sum" numeric(15, 3) NOT NULL,
	"projection_qty" numeric(15, 3) NOT NULL,
	"variance" numeric(15, 3) NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"adjustment_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"direction" varchar(4) NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"system_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(15, 2),
	"line_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"adjustment_number" varchar(30) NOT NULL,
	"warehouse_id" integer NOT NULL,
	"adjustment_type" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"total_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_adjustments_tenant_number" UNIQUE("tenant_id","adjustment_number")
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"warehouse_id" integer NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"reference_type" varchar(50) NOT NULL,
	"reference_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"transfer_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"requested_qty" numeric(15, 3) NOT NULL,
	"dispatched_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"received_qty" numeric(15, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(15, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"transfer_number" varchar(30) NOT NULL,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"dispatched_by" integer,
	"dispatched_at" timestamp with time zone,
	"received_by" integer,
	"received_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"saga_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_transfers_tenant_number" UNIQUE("tenant_id","transfer_number")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"credit_note_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"sale_return_id" integer,
	"original_invoice_id" integer,
	"status" varchar(30) DEFAULT 'OPEN' NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"used_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"remaining_amount" numeric(15, 2) NOT NULL,
	"expiry_date" timestamp with time zone,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_notes_tenant_number" UNIQUE("tenant_id","credit_note_number")
);
--> statement-breakpoint
CREATE TABLE "delivery_challan_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"challan_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"line_number" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"description" text,
	"quantity" numeric(15, 3) NOT NULL,
	"unit_id" integer,
	"unit_price" numeric(15, 2),
	"hsn_code" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_challans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"challan_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"challan_date" timestamp with time zone NOT NULL,
	"delivery_address" jsonb,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"converted_invoice_id" integer,
	"converted_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "delivery_challans_tenant_number" UNIQUE("tenant_id","challan_number")
);
--> statement-breakpoint
CREATE TABLE "invoice_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"action" varchar(100) NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30),
	"performed_by" integer NOT NULL,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"line_number" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"description" text,
	"quantity" numeric(15, 3) NOT NULL,
	"unit_id" integer,
	"unit_price" numeric(15, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"sgst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"igst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	"hsn_code" varchar(20),
	"warehouse_id" integer,
	"reservation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"invoice_number" varchar(50),
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"customer_id" integer NOT NULL,
	"quotation_id" integer,
	"delivery_challan_id" integer,
	"place_of_supply" varchar(2) NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"payment_terms" varchar(50),
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"balance_due" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"rounding_amount" numeric(8, 2) DEFAULT '0' NOT NULL,
	"loyalty_points_earned" integer DEFAULT 0 NOT NULL,
	"loyalty_points_redeemed" integer DEFAULT 0 NOT NULL,
	"loyalty_redemption_value" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pdf_url" text,
	"pdf_generated_at" timestamp with time zone,
	"notes" text,
	"delivery_date" timestamp with time zone,
	"delivery_address" jsonb,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"approval_id" integer,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoices_tenant_number" UNIQUE("tenant_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "loyalty_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"points" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_type" varchar(50),
	"reference_id" integer,
	"expiry_date" timestamp with time zone,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allocated_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"payment_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"payment_date" timestamp with time zone NOT NULL,
	"payment_mode" varchar(30) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"allocated_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"unallocated_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"status" varchar(30) DEFAULT 'RECEIVED' NOT NULL,
	"cheque_number" varchar(30),
	"cheque_bank_name" varchar(100),
	"cheque_date" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"bounce_reason" text,
	"transaction_reference" varchar(100),
	"notes" text,
	"pos_session_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payments_tenant_number" UNIQUE("tenant_id","payment_number")
);
--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"session_number" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"opened_by" integer NOT NULL,
	"closed_by" integer,
	"opening_cash" numeric(15, 2) DEFAULT '0' NOT NULL,
	"closing_cash" numeric(15, 2),
	"expected_cash" numeric(15, 2),
	"cash_variance" numeric(15, 2),
	"total_sales" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projection_customer_balance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"current_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_invoiced" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_paid" numeric(15, 2) DEFAULT '0' NOT NULL,
	"overdue_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"last_invoice_at" timestamp with time zone,
	"last_payment_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proj_customer_balance_unique" UNIQUE("tenant_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "projection_dashboard_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"sales_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"collected_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"return_count" integer DEFAULT 0 NOT NULL,
	"return_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proj_dashboard_daily_unique" UNIQUE("tenant_id","branch_id","date")
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"line_number" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"description" text,
	"quantity" numeric(15, 3) NOT NULL,
	"unit_id" integer,
	"unit_price" numeric(15, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"sgst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"igst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	"hsn_code" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"quotation_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"place_of_supply" varchar(2) NOT NULL,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"notes" text,
	"terms_and_conditions" text,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"converted_invoice_id" integer,
	"converted_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quotations_tenant_number" UNIQUE("tenant_id","quotation_number")
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"invoice_line_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_id" integer,
	"return_qty" numeric(15, 3) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"return_number" varchar(50) NOT NULL,
	"invoice_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"return_date" timestamp with time zone NOT NULL,
	"reason" varchar(100) NOT NULL,
	"is_physical_return" boolean DEFAULT true NOT NULL,
	"warehouse_id" integer,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credit_note_id" integer,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sale_returns_tenant_number" UNIQUE("tenant_id","return_number")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "available_qty" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reserved_qty" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_fc_roll" ON "fabric_cuts" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "idx_fc_tenant_date" ON "fabric_cuts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_fr_tenant_item" ON "fabric_rolls" USING btree ("tenant_id","item_id","status");--> statement-breakpoint
CREATE INDEX "idx_fr_warehouse" ON "fabric_rolls" USING btree ("warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_fr_received" ON "fabric_rolls" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_inv_ledger_tenant_item_wh" ON "inventory_ledger" USING btree ("tenant_id","item_id","warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_inv_ledger_reference" ON "inventory_ledger" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_inv_ledger_tenant_date" ON "inventory_ledger" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pvl_verification" ON "physical_verification_lines" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "idx_pvl_item" ON "physical_verification_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pv_tenant_status" ON "physical_verifications" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_pv_warehouse" ON "physical_verifications" USING btree ("warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_psl_tenant_item" ON "projection_stock_level" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "idx_psl_warehouse" ON "projection_stock_level" USING btree ("warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_psl_below_reorder" ON "projection_stock_level" USING btree ("tenant_id","available_qty");--> statement-breakpoint
CREATE INDEX "idx_recon_tenant_unresolved" ON "reconciliation_errors" USING btree ("tenant_id","resolved_at");--> statement-breakpoint
CREATE INDEX "idx_recon_item" ON "reconciliation_errors" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sal_adjustment" ON "stock_adjustment_lines" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "idx_sal_item" ON "stock_adjustment_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sa_tenant_status" ON "stock_adjustments" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_sa_warehouse" ON "stock_adjustments" USING btree ("warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_tenant_item" ON "stock_reservations" USING btree ("tenant_id","item_id","status");--> statement-breakpoint
CREATE INDEX "idx_reservations_reference" ON "stock_reservations" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_expiry" ON "stock_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_stl_transfer" ON "stock_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "idx_stl_item" ON "stock_transfer_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_st_tenant_status" ON "stock_transfers" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_st_from_wh" ON "stock_transfers" USING btree ("from_warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_st_to_wh" ON "stock_transfers" USING btree ("to_warehouse_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_credit_notes_customer" ON "credit_notes" USING btree ("customer_id","tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_dc_lines_challan" ON "delivery_challan_lines" USING btree ("challan_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_challans_tenant" ON "delivery_challans" USING btree ("tenant_id","status","challan_date");--> statement-breakpoint
CREATE INDEX "idx_delivery_challans_customer" ON "delivery_challans" USING btree ("customer_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_history_invoice" ON "invoice_history" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_history_tenant" ON "invoice_history" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_item" ON "invoice_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_tenant_status" ON "invoices" USING btree ("tenant_id","status","invoice_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_customer" ON "invoices" USING btree ("customer_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_due_date" ON "invoices" USING btree ("due_date","status","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_branch" ON "invoices" USING btree ("branch_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_loyalty_customer" ON "loyalty_transactions" USING btree ("customer_id","tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_loyalty_expiry" ON "loyalty_transactions" USING btree ("expiry_date","type","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_payment" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_invoice" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_payments_tenant_customer" ON "payments" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_payments_date" ON "payments" USING btree ("tenant_id","payment_date");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_pos_sessions_tenant_status" ON "pos_sessions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_pos_sessions_branch" ON "pos_sessions" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_proj_customer_balance_tenant" ON "projection_customer_balance" USING btree ("tenant_id","current_balance");--> statement-breakpoint
CREATE INDEX "idx_proj_dashboard_date" ON "projection_dashboard_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "idx_quotation_lines_quotation" ON "quotation_lines" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "idx_quotation_lines_item" ON "quotation_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_quotations_tenant_status" ON "quotations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_quotations_customer" ON "quotations" USING btree ("customer_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_quotations_valid_until" ON "quotations" USING btree ("valid_until","status");--> statement-breakpoint
CREATE INDEX "idx_sale_return_lines_return" ON "sale_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "idx_sale_return_lines_item" ON "sale_return_lines" USING btree ("item_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sale_returns_invoice" ON "sale_returns" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_sale_returns_customer" ON "sale_returns" USING btree ("customer_id","tenant_id");