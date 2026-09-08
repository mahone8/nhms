-- Tracks which migration files have been applied. The migration runner
-- (db/migrate.js) consults this table so re-running `npm run migrate` is
-- always safe -- already-applied files are skipped.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
