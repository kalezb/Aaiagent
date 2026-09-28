-- Per-device settings, monthly budget month, and chat request throttling.
ALTER TABLE tokens ADD COLUMN spent_month TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS device_settings (
    token             TEXT PRIMARY KEY,
    platform          TEXT NOT NULL DEFAULT 'soul',
    hosting_enabled   INTEGER NOT NULL DEFAULT 0,
    monitor_enabled   INTEGER NOT NULL DEFAULT 1,
    weather_enabled   INTEGER NOT NULL DEFAULT 1,
    time_enabled      INTEGER NOT NULL DEFAULT 1,
    updated_at        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS request_limits (
    token          TEXT NOT NULL,
    scope          TEXT NOT NULL,
    window_start   INTEGER NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, scope)
);
