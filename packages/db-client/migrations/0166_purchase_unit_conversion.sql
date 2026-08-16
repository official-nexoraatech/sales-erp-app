-- Multi-vertical platform audit 2026-08-16: items had exactly one unit — no way to represent
-- "buy a case of 24, stock/sell by the piece." purchaseUnitConversionFactor is how many of an
-- item's base unit (unitId) make up one of its purchase unit (purchaseUnitId); grnLines gets a
-- separate receivedQtyBaseUnit so the PO-vs-GRN received-qty ceiling check (compared in the
-- ordering unit) is untouched while stock/ledger/valuation get the converted base-unit quantity.
-- All columns nullable — no behavior change for items that never set a purchase unit.
ALTER TABLE "items" ADD COLUMN "purchase_unit_id" integer;
ALTER TABLE "items" ADD COLUMN "purchase_unit_conversion_factor" numeric(15, 3);
ALTER TABLE "grn_lines" ADD COLUMN "received_qty_base_unit" numeric(15, 3);
