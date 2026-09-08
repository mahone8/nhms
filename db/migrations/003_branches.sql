-- Branches are not hard-coded anywhere in the schema -- Super Admin can add
-- branch 6, 7, 8... at any time through this table alone.
CREATE TABLE IF NOT EXISTS branches (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  address       TEXT,
  contact       TEXT,
  capacity      INTEGER NOT NULL DEFAULT 36 CHECK (capacity > 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
