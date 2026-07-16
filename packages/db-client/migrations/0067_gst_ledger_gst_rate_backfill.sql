-- Backfill gst_ledger.gst_rate for rows written before the InvoiceGstConsumer /
-- SaleReturnGstConsumer / GRNGstConsumer fix (2026-07-13 QA session).
--
-- Root cause: INVOICE_CONFIRMED (and the credit-note/GRN equivalents) never actually
-- carried a gstRate field in their event payload, so every consumer wrote gst_rate as
-- NULL. GSTR-9 reads this field to split taxable vs nil-rated revenue, so every NULL row
-- was misclassified as nil-rated. The consumers now derive the rate from the tax actually
-- charged: (total_gst - cess_amount) / taxable_amount * 100. This backfills existing rows
-- with the exact same formula so historical data matches what new rows compute.
UPDATE "gst_ledger"
SET "gst_rate" = CASE
  WHEN "taxable_amount" > 0 THEN ROUND((("total_gst" - "cess_amount") / "taxable_amount") * 100, 2)
  ELSE 0
END
WHERE "gst_rate" IS NULL;
