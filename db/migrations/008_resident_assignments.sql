-- The permanent stay-history ledger. Check-in inserts a row with end_date
-- NULL; transfer closes it (sets end_date) and inserts a new one; check-out
-- closes it and leaves no new open row. Rows are never rewritten.
CREATE TABLE IF NOT EXISTS resident_assignments (
  id                    BIGSERIAL PRIMARY KEY,
  resident_id           BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  room_id               BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  bed_id                BIGINT NOT NULL REFERENCES beds(id) ON DELETE RESTRICT,
  start_date            DATE NOT NULL,
  end_date              DATE,
  rent_at_assignment    NUMERIC(12, 2) NOT NULL,
  reason                TEXT NOT NULL CHECK (reason IN ('check_in', 'transfer', 'check_out')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_assignments_resident ON resident_assignments(resident_id);
CREATE INDEX IF NOT EXISTS idx_assignments_bed ON resident_assignments(bed_id);

-- Only one open (current) assignment per resident, and only one per bed,
-- at any given time -- this is what makes "no duplicate active occupancy"
-- a database guarantee rather than just an application convention.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_assignment_per_resident
  ON resident_assignments(resident_id) WHERE end_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_assignment_per_bed
  ON resident_assignments(bed_id) WHERE end_date IS NULL;
