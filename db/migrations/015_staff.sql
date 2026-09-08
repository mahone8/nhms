-- Staff records do NOT automatically create login accounts, and there is
-- no receptionist/accountant/branch-manager role anywhere in this schema --
-- see users.role, which only ever allows super_admin, admin, or resident.
CREATE TABLE IF NOT EXISTS staff (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  cnic            TEXT,
  phone           TEXT,
  position        TEXT,
  branch_id       BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  joining_date    DATE,
  salary          NUMERIC(12, 2),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_branch ON staff(branch_id);

DROP TRIGGER IF EXISTS trg_staff_updated_at ON staff;
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
