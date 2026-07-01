UPDATE items
SET is_deleted = TRUE
WHERE status = 'INACTIVE';

UPDATE items item
SET status = CASE
    WHEN stock_totals.available_qty <= 0 THEN 'OUT_OF_STOCK'
    WHEN stock_totals.minimum_stock > 0 AND stock_totals.available_qty <= stock_totals.minimum_stock THEN 'LOW_STOCK'
    ELSE 'IN_STOCK'
END
FROM (
    SELECT
        item_id,
        COALESCE(SUM(COALESCE(available_qty, 0)), 0) AS available_qty,
        COALESCE(SUM(COALESCE(minimum_stock, 0)), 0) AS minimum_stock
    FROM stock
    WHERE item_id IS NOT NULL
    GROUP BY item_id
) stock_totals
WHERE item.id = stock_totals.item_id;

UPDATE items item
SET status = 'OUT_OF_STOCK'
WHERE NOT EXISTS (
    SELECT 1
    FROM stock
    WHERE stock.item_id = item.id
);

ALTER TABLE items
ALTER COLUMN status SET DEFAULT 'OUT_OF_STOCK';

ALTER TABLE items
DROP CONSTRAINT IF EXISTS chk_items_status;

ALTER TABLE items
ADD CONSTRAINT chk_items_status
CHECK (status IN ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'));
