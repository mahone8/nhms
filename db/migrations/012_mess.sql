-- There is exactly ONE common mess shared across all branches -- none of
-- these tables have a branch_id, by design. Mess finances are intentionally
-- kept separate from resident hostel dues (charges/payments above).

CREATE TABLE IF NOT EXISTS mess_members (
  id              BIGSERIAL PRIMARY KEY,
  resident_id     BIGINT NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE,
  joined_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Structured weekly/daily menu entries (what's being served).
CREATE TABLE IF NOT EXISTS menus (
  id              BIGSERIAL PRIMARY KEY,
  menu_date       DATE NOT NULL,
  meal_type       TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
  items           TEXT NOT NULL,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_date, meal_type)
);

-- One row per member per meal eaten -- this doubles as attendance.
CREATE TABLE IF NOT EXISTS meal_records (
  id              BIGSERIAL PRIMARY KEY,
  mess_member_id  BIGINT NOT NULL REFERENCES mess_members(id) ON DELETE CASCADE,
  meal_date       DATE NOT NULL,
  meal_type       TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mess_member_id, meal_date, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_records_date ON meal_records(meal_date);

-- Groceries and other mess-related spending. Category 'groceries' covers
-- what the spec calls "Groceries" and "Food expenses".
CREATE TABLE IF NOT EXISTS mess_expenses (
  id              BIGSERIAL PRIMARY KEY,
  category        TEXT NOT NULL CHECK (category IN ('groceries', 'utilities', 'staff', 'equipment', 'other')),
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  recorded_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mess_expenses_date ON mess_expenses(date);

-- Preserved from the existing system: one shared menu *image* (PNG/JPG)
-- shown to residents across all branches. Kept alongside the new
-- structured `menus` table above rather than replaced -- it's a working
-- feature the hostel already uses day to day.
CREATE TABLE IF NOT EXISTS hostel_menu_image (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  file_name     TEXT,
  file_url      TEXT,
  uploaded_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ
);
