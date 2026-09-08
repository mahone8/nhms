-- Tracks the admission workflow described in the spec:
-- Inquiry -> Registration -> Verification -> Select Branch -> Available
-- Rooms/Beds -> Select Bed -> Registration Fee -> Security Fee ->
-- Confirmation -> Check-in.
-- Once check-in completes, resident_id is set and status becomes 'converted'.
CREATE TABLE IF NOT EXISTS admissions (
  id                  BIGSERIAL PRIMARY KEY,
  full_name           TEXT NOT NULL,
  phone               TEXT,
  cnic                TEXT,
  branch_id           BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  bed_id              BIGINT REFERENCES beds(id) ON DELETE SET NULL,
  registration_fee    NUMERIC(12, 2),
  security_fee        NUMERIC(12, 2),
  status              TEXT NOT NULL DEFAULT 'inquiry'
                       CHECK (status IN ('inquiry', 'registration', 'verification', 'confirmed', 'converted', 'cancelled')),
  resident_id         BIGINT REFERENCES residents(id) ON DELETE SET NULL,
  notes               TEXT,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admissions_status ON admissions(status);
CREATE INDEX IF NOT EXISTS idx_admissions_branch ON admissions(branch_id);

DROP TRIGGER IF EXISTS trg_admissions_updated_at ON admissions;
CREATE TRIGGER trg_admissions_updated_at
  BEFORE UPDATE ON admissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
