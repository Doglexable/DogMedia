ALTER TABLE categories
ADD COLUMN IF NOT EXISTS sort_order INTEGER;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY parent_id
      ORDER BY name, id
    ) - 1 AS position
  FROM categories
)
UPDATE categories
SET sort_order = ranked.position::INTEGER
FROM ranked
WHERE categories.id = ranked.id
  AND categories.sort_order IS NULL;

ALTER TABLE categories
ALTER COLUMN sort_order SET DEFAULT 0,
ALTER COLUMN sort_order SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent_sort
ON categories(parent_id, sort_order);
