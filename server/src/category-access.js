// Category access belongs to the media's own folder. Hidden ancestors remain
// traversable for ordering, but their names are omitted from public paths.
export const ACCESSIBLE_CATEGORY_TREE_SQL = `
  WITH RECURSIVE category_tree AS (
    SELECT
      c.id, c.parent_id, c.min_access_tier, c.name, c.cover_path,
      COALESCE(c.sort_order, 0) AS sort_order,
      CASE WHEN c.min_access_tier <= $1 THEN ARRAY[c.name::text] ELSE ARRAY[]::text[] END AS path_parts,
      ARRAY[COALESCE(c.sort_order, 0)]::integer[] AS order_parts
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT
      c.id, c.parent_id, c.min_access_tier, c.name, c.cover_path,
      COALESCE(c.sort_order, 0),
      CASE WHEN c.min_access_tier <= $1 THEN ct.path_parts || c.name::text ELSE ct.path_parts END,
      ct.order_parts || COALESCE(c.sort_order, 0)
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
  ), accessible_categories AS (
    SELECT * FROM category_tree WHERE min_access_tier <= $1
  )
`;

export const ACCESSIBLE_CATEGORY_IDS_SQL = `
  WITH accessible_categories AS (
    SELECT id FROM categories WHERE min_access_tier <= $1
  )
`;
