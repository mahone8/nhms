-- Spec section 15 (Transfer) asks to "Record transfer reason" as a
-- specific, human-readable explanation -- distinct from
-- resident_assignments.reason, which is just the category
-- ('check_in' / 'transfer' / 'check_out'). This adds a place for that
-- free-text explanation, usable by any assignment type, not just
-- transfers.
ALTER TABLE resident_assignments ADD COLUMN IF NOT EXISTS notes TEXT;
