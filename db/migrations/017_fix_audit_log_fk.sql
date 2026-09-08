-- Bug found during Phase 3 RBAC testing: deleting a user who has audit
-- history triggered the FK's "ON DELETE SET NULL" behavior, which issues
-- an UPDATE against audit_logs -- and the append-only trigger from
-- migration 014 correctly refuses that UPDATE, so the delete failed with
-- a confusing "audit_logs is append-only" error instead of a clear one.
--
-- The fix: change the FK to ON DELETE RESTRICT instead. This is also the
-- more correct behavior for an audit trail -- a user who has ever done
-- something worth logging should never be hard-deleted (losing who did
-- it), only deactivated (users.status = 'inactive'). RESTRICT makes that
-- an enforced rule instead of a convention.
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey,
  ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
