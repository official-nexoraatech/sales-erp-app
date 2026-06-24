UPDATE contacts
SET first_name = left(btrim(company_name), 100)
WHERE (first_name IS NULL OR btrim(first_name) = '')
  AND company_name IS NOT NULL
  AND btrim(company_name) <> '';

ALTER TABLE IF EXISTS contacts
DROP COLUMN IF EXISTS company_name;
