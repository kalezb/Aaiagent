CREATE TABLE IF NOT EXISTS user_locations (
    token         TEXT PRIMARY KEY,
    home_city     TEXT NOT NULL DEFAULT '重庆',
    home_district TEXT NOT NULL DEFAULT '两江新区',
    work_city     TEXT NOT NULL DEFAULT '重庆',
    work_district TEXT NOT NULL DEFAULT '两江新区',
    updated_at    INTEGER NOT NULL
);
