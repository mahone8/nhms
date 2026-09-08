CREATE TABLE IF NOT EXISTS beds (
  id            BIGSERIAL PRIMARY KEY,
  branch_id     BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  room_id       BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  bed_number    INTEGER NOT NULL CHECK (bed_number > 0),
  status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_number)
);

CREATE INDEX IF NOT EXISTS idx_beds_branch ON beds(branch_id);
CREATE INDEX IF NOT EXISTS idx_beds_room ON beds(room_id);
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);

-- A bed's branch_id must always match its room's branch_id. Rather than
-- trust the caller to keep these in sync, derive it automatically.
CREATE OR REPLACE FUNCTION sync_bed_branch_from_room()
RETURNS TRIGGER AS $$
BEGIN
  SELECT branch_id INTO NEW.branch_id FROM rooms WHERE id = NEW.room_id;
  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'Room % does not exist', NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_beds_sync_branch ON beds;
CREATE TRIGGER trg_beds_sync_branch
  BEFORE INSERT OR UPDATE OF room_id ON beds
  FOR EACH ROW EXECUTE FUNCTION sync_bed_branch_from_room();

-- Enforce: a room can never hold more beds than its own capacity, and a
-- branch can never hold more beds than its configured capacity (36 by
-- default, but Super Admin can raise it -- see branches.capacity).
CREATE OR REPLACE FUNCTION enforce_bed_capacity()
RETURNS TRIGGER AS $$
DECLARE
  room_capacity INTEGER;
  room_bed_count INTEGER;
  branch_capacity INTEGER;
  branch_bed_count INTEGER;
BEGIN
  SELECT capacity INTO room_capacity FROM rooms WHERE id = NEW.room_id;
  SELECT COUNT(*) INTO room_bed_count FROM beds
    WHERE room_id = NEW.room_id AND id IS DISTINCT FROM NEW.id;
  IF room_bed_count + 1 > room_capacity THEN
    RAISE EXCEPTION 'Room % is already at its capacity of % beds', NEW.room_id, room_capacity;
  END IF;

  SELECT capacity INTO branch_capacity FROM branches WHERE id = NEW.branch_id;
  SELECT COUNT(*) INTO branch_bed_count FROM beds
    WHERE branch_id = NEW.branch_id AND id IS DISTINCT FROM NEW.id;
  IF branch_bed_count + 1 > branch_capacity THEN
    RAISE EXCEPTION 'Branch % is already at its configured capacity of % beds', NEW.branch_id, branch_capacity;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_beds_enforce_capacity ON beds;
CREATE TRIGGER trg_beds_enforce_capacity
  BEFORE INSERT ON beds
  FOR EACH ROW EXECUTE FUNCTION enforce_bed_capacity();

DROP TRIGGER IF EXISTS trg_beds_updated_at ON beds;
CREATE TRIGGER trg_beds_updated_at
  BEFORE UPDATE ON beds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
