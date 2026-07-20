CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    min_access_tier INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_assets (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    file_path   VARCHAR(512) NOT NULL,
    duration    INTEGER,
    mime_type   VARCHAR(100),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_category ON media_assets(category_id);

CREATE TABLE IF NOT EXISTS ip_whitelist (
    id          SERIAL PRIMARY KEY,
    cidr_range  CIDR NOT NULL UNIQUE,
    access_tier INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_whitelist_cidr ON ip_whitelist USING gist (cidr_range inet_ops);
