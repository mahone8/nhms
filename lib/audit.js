/**
 * Every Admin (and Super Admin) action that matters gets recorded here.
 * Writing is the only operation this ever does -- the audit_logs table
 * itself refuses UPDATE/DELETE at the database level (see migration 014),
 * so there's no code path, here or anywhere else, that could edit or
 * erase a log entry after the fact.
 */
const { query } = require("../db/pool");

async function logAction({
  userId = null,
  role = null,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  metadata = null,
  ipAddress = null,
}) {
  await query(
    `INSERT INTO audit_logs (user_id, role, action, entity_type, entity_id, old_values, new_values, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId, role, action, entityType, entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress,
    ]
  );
}

module.exports = { logAction };
