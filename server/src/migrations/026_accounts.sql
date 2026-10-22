CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(40) NOT NULL,
    password_hash TEXT NOT NULL,
    access_tier INTEGER NOT NULL DEFAULT 0 CHECK (access_tier >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci ON users (lower(username));
