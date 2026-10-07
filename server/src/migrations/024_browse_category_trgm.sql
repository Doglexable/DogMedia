CREATE INDEX IF NOT EXISTS idx_categories_name_trgm
    ON categories USING gin (lower(name) gin_trgm_ops);
