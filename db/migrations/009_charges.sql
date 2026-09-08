-- Charges represent what a resident OWES. Never confuse with payments
-- (what was actually collected) -- see routes/finance for the outstanding
-- balance formula: Outstanding = Total Charges - Total Paid.
CREATE TABLE IF NOT EXISTS charges (
  id              BIGSERIAL PRIMARY KEY,
  resident_id     BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  branch_id       BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('monthly_rent', 'security_fee', 'registration_fee', 'other', 'discount', 'adjustment')),
  amount          NUMERIC(12, 2) NOT NULL,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('paid', 'partially_paid', 'due', 'overdue')),
  description     TEXT,
  -- first-of-month marker used only by monthly_rent charges, so a second
  -- run of the auto-rent job for the same resident + month is a no-op
  -- (idempotency), enforced by the partial unique index below.
  period_month    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type NOT IN ('discount', 'adjustment') OR amount IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_charges_resident ON charges(resident_id);
CREATE INDEX IF NOT EXISTS idx_charges_branch ON charges(branch_id);
CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status);
CREATE INDEX IF NOT EXISTS idx_charges_due_date ON charges(due_date);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_monthly_rent_per_period
  ON charges(resident_id, period_month) WHERE type = 'monthly_rent';
