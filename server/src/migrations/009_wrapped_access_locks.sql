CREATE TABLE IF NOT EXISTS wrapped_access_locks (
    client_ip      INET PRIMARY KEY,
    last_opened_at TIMESTAMPTZ NOT NULL,
    next_open_at   TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wrapped_access_locks_next_open ON wrapped_access_locks(next_open_at);
