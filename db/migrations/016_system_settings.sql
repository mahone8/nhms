-- Super Admin-only configuration: hostel name, room types, bathroom
-- categories, rent rate defaults, fee types, payment methods, notification
-- settings, and other system-wide preferences. Simple key/value + JSONB so
-- new setting keys don't require a migration.
CREATE TABLE IF NOT EXISTS system_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
