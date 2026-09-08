-- Every resident has exactly one linked login account (users row, role
-- 'resident'), created at check-in so they can access the resident portal.
CREATE TABLE IF NOT EXISTS residents (
  id                        BIGSERIAL PRIMARY KEY,
  user_id                   BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,

  -- current placement (NULL room/bed once checked out; branch is kept for history/reporting)
  branch_id                 BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  room_id                   BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
  bed_id                    BIGINT REFERENCES beds(id) ON DELETE SET NULL,

  -- personal information
  full_name                 TEXT NOT NULL,
  father_guardian_name      TEXT,
  cnic                      TEXT,
  date_of_birth             DATE,
  phone                     TEXT,
  emergency_contact         TEXT,
  permanent_address         TEXT,

  -- education
  university                TEXT,
  department                TEXT,
  student_id                TEXT,
  program                   TEXT,
  semester_year             TEXT,

  -- hostel
  joining_date              DATE NOT NULL,
  expected_checkout_date    DATE,
  status                    TEXT NOT NULL DEFAULT 'reserved'
                             CHECK (status IN ('active', 'reserved', 'checked_out', 'suspended')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_residents_branch ON residents(branch_id);
CREATE INDEX IF NOT EXISTS idx_residents_status ON residents(status);
CREATE INDEX IF NOT EXISTS idx_residents_bed ON residents(bed_id);

-- No duplicate active occupancy: at most one Active resident per bed at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_resident_per_bed
  ON residents(bed_id) WHERE status = 'active' AND bed_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_residents_updated_at ON residents;
CREATE TRIGGER trg_residents_updated_at
  BEFORE UPDATE ON residents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
