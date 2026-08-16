-- ItemServiceImpl.buildStock() used to insert a new stock row on every item edit
-- instead of updating the existing one, so items edited more than once ended up
-- with multiple stock rows. Every stock-affecting operation (sale, purchase,
-- transfer, adjustment, further edits) looks up stock by item id expecting a
-- single row, so any duplicated item is currently broken for all of them.
-- Keep the newest row per item (most recent edit's values) and drop the rest.
DELETE FROM stock
WHERE id IN (
    SELECT id
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY id DESC) AS rn
        FROM stock
    ) ranked
    WHERE rn > 1
);
