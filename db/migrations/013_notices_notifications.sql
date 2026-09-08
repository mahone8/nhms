-- Notices: admin/super_admin authored, targeted at all residents, one
-- branch, or one individual resident.
CREATE TABLE IF NOT EXISTS notices (
  id                  BIGSERIAL PRIMARY KEY,
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  target_type         TEXT NOT NULL CHECK (target_type IN ('all', 'branch', 'resident')),
  target_branch_id    BIGINT REFERENCES branches(id) ON DELETE CASCADE,
  target_resident_id  BIGINT REFERENCES residents(id) ON DELETE CASCADE,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expiry_date         DATE,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'archived')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'all' AND target_branch_id IS NULL AND target_resident_id IS NULL) OR
    (target_type = 'branch' AND target_branch_id IS NOT NULL AND target_resident_id IS NULL) OR
    (target_type = 'resident' AND target_resident_id IS NOT NULL AND target_branch_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_notices_target_branch ON notices(target_branch_id);
CREATE INDEX IF NOT EXISTS idx_notices_target_resident ON notices(target_resident_id);

-- Notifications: system-generated, per-user (e.g. payment reminders).
CREATE TABLE IF NOT EXISTS notifications (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  message               TEXT NOT NULL,
  type                  TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'payment_reminder', 'notice', 'system')),
  is_read               BOOLEAN NOT NULL DEFAULT false,
  related_entity_type   TEXT,
  related_entity_id     BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE is_read = false;
