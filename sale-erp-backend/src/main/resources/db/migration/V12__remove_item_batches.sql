ALTER TABLE items
    ADD COLUMN IF NOT EXISTS manufacturing_date DATE,
    ADD COLUMN IF NOT EXISTS expiry_date DATE;

UPDATE items i
SET manufacturing_date = b.manufacturing_date,
    expiry_date = b.expiry_date
FROM item_batches b
WHERE b.item_id = i.id;

DROP INDEX IF EXISTS idx_stock_item_warehouse_batch_id;
CREATE INDEX IF NOT EXISTS idx_stock_item_warehouse ON stock (item_id, warehouse_id);

ALTER TABLE stock DROP CONSTRAINT IF EXISTS fk_stock_batch;
ALTER TABLE stock DROP COLUMN IF EXISTS batch_id;

ALTER TABLE stock_transactions DROP CONSTRAINT IF EXISTS fk_stock_transactions_batch;
ALTER TABLE stock_transactions DROP COLUMN IF EXISTS batch_id;

ALTER TABLE purchase_items DROP CONSTRAINT IF EXISTS fk_purchase_items_batch;
ALTER TABLE purchase_items DROP COLUMN IF EXISTS batch_id;

ALTER TABLE purchase_return_items DROP CONSTRAINT IF EXISTS fk_purchase_return_items_batch;
ALTER TABLE purchase_return_items DROP COLUMN IF EXISTS batch_id;

ALTER TABLE sales_items DROP CONSTRAINT IF EXISTS fk_sales_items_batch;
ALTER TABLE sales_items DROP COLUMN IF EXISTS batch_id;

ALTER TABLE sales_return_items DROP CONSTRAINT IF EXISTS fk_sales_return_items_batch;
ALTER TABLE sales_return_items DROP COLUMN IF EXISTS batch_id;

ALTER TABLE stock_adjustment_items DROP CONSTRAINT IF EXISTS fk_stock_adjustment_items_batch;
ALTER TABLE stock_adjustment_items DROP COLUMN IF EXISTS batch_id;

ALTER TABLE stock_transfer_items DROP CONSTRAINT IF EXISTS fk_stock_transfer_items_batch;
ALTER TABLE stock_transfer_items DROP COLUMN IF EXISTS batch_id;

DROP TABLE IF EXISTS item_batches;
