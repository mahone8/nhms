CREATE TABLE IF NOT EXISTS payments (
  id                BIGSERIAL PRIMARY KEY,
  resident_id       BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  branch_id         BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_type      TEXT NOT NULL CHECK (payment_type IN ('monthly_rent', 'security_fee', 'registration_fee', 'other', 'refund')),
  payment_method    TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'online_payment', 'other')),
  payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_number    TEXT NOT NULL UNIQUE,
  notes             TEXT,
  recorded_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_resident ON payments(resident_id);
CREATE INDEX IF NOT EXISTS idx_payments_branch ON payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
