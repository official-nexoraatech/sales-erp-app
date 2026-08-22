-- Manufacturing vertical — MRP (Material Requirements Planning): ties BOM + Production Orders +
-- stock + Purchase Orders together. No new tables — MRPService computes net requirements on
-- demand (same stateless-report pattern as ReorderService.getReorderRequired(), not a persisted
-- "MRP run" entity) and, for raw-material shortages, writes a normal purchase_requisitions row
-- via the existing table (same direct-write-across-domain precedent as
-- ReorderService.createPOsFromReorder() writing purchase_orders directly).
UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "INVENTORY_BATCH", "BOM", "WORK_CENTERS", "PRODUCTION_ORDER", "ROUTING", "MRP"]'::jsonb
WHERE code = 'MANUFACTURING';
