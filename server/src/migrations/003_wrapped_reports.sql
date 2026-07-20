CREATE TABLE IF NOT EXISTS wrapped_reports (
    id              SERIAL PRIMARY KEY,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    total_play_time INTEGER NOT NULL DEFAULT 0,
    total_plays     INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT wrapped_reports_period_check CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_wrapped_reports_period ON wrapped_reports(period_start, period_end);

CREATE TABLE IF NOT EXISTS wrapped_top_media (
    id                SERIAL PRIMARY KEY,
    wrapped_report_id INTEGER NOT NULL REFERENCES wrapped_reports(id) ON DELETE CASCADE,
    media_id          INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
    title             VARCHAR(255) NOT NULL,
    play_count        INTEGER NOT NULL DEFAULT 0,
    total_time        INTEGER NOT NULL DEFAULT 0,
    rank              INTEGER NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT wrapped_top_media_rank_unique UNIQUE (wrapped_report_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_wrapped_top_media_report ON wrapped_top_media(wrapped_report_id);
CREATE INDEX IF NOT EXISTS idx_wrapped_top_media_media ON wrapped_top_media(media_id);

CREATE TABLE IF NOT EXISTS wrapped_timeline_days (
    id                SERIAL PRIMARY KEY,
    wrapped_report_id INTEGER NOT NULL REFERENCES wrapped_reports(id) ON DELETE CASCADE,
    activity_date     DATE NOT NULL,
    play_time         INTEGER NOT NULL DEFAULT 0,
    plays             INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT wrapped_timeline_days_date_unique UNIQUE (wrapped_report_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_wrapped_timeline_days_report ON wrapped_timeline_days(wrapped_report_id);
