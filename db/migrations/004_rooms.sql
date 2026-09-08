-- Room capacity is derived automatically from room_type, so the app never
-- has to compute or trust a client-sent capacity value.
CREATE TABLE IF NOT EXISTS rooms (
  id              BIGSERIAL PRIMARY KEY,
  branch_id       BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  room_number     TEXT NOT NULL,
  floor           TEXT,
  room_type       TEXT NOT NULL CHECK (room_type IN ('1 Seater', '2 Seater', '3 Seater', '4 Seater')),
  bathroom_type   TEXT NOT NULL CHECK (bathroom_type IN ('Attached Bath', 'Common Bath')),
  capacity        INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 4),
  monthly_rent    NUMERIC(12, 2) NOT NULL CHECK (monthly_rent >= 0),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, room_number),
  CHECK (
    (room_type = '1 Seater' AND capacity = 1) OR
    (room_type = '2 Seater' AND capacity = 2) OR
    (room_type = '3 Seater' AND capacity = 3) OR
    (room_type = '4 Seater' AND capacity = 4)
  )
);

CREATE INDEX IF NOT EXISTS idx_rooms_branch ON rooms(branch_id);

-- Auto-fill capacity from room_type so callers only ever need to send room_type.
CREATE OR REPLACE FUNCTION set_room_capacity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.capacity := CASE NEW.room_type
    WHEN '1 Seater' THEN 1
    WHEN '2 Seater' THEN 2
    WHEN '3 Seater' THEN 3
    WHEN '4 Seater' THEN 4
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rooms_set_capacity ON rooms;
CREATE TRIGGER trg_rooms_set_capacity
  BEFORE INSERT OR UPDATE OF room_type ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_room_capacity();

DROP TRIGGER IF EXISTS trg_rooms_updated_at ON rooms;
CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
