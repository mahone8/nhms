-- branch_id NULL means a "Common / All Branches" expense.
CREATE TABLE IF NOT EXISTS expenses (
  id              BIGSERIAL PRIMARY KEY,
  branch_id       BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'electricity', 'gas', 'water', 'internet', 'salaries',
                    'food', 'cleaning', 'transportation', 'rent', 'miscellaneous', 'other'
                  )),
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  recorded_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
