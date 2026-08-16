ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS expense_sub_category_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_expenses_expense_sub_category'
    ) THEN
        ALTER TABLE expenses
            ADD CONSTRAINT fk_expenses_expense_sub_category
            FOREIGN KEY (expense_sub_category_id) REFERENCES expense_sub_categories (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_expense_sub_category_id
    ON expenses (expense_sub_category_id);
