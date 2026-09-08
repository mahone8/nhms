const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { logAction } = require("../lib/audit");

const router = express.Router();
router.use(requireRole("super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT key, value, updated_at FROM system_settings ORDER BY key");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

router.get("/:key", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM system_settings WHERE key = $1", [req.params.key]);
  if (!rows[0]) return res.status(404).json({ error: "Setting not found." });
  res.json(rows[0]);
}));

router.put("/:key", asyncHandler(async (req, res) => {
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: "value is required." });

  const existing = await query("SELECT value FROM system_settings WHERE key = $1", [req.params.key]);
  const { rows } = await query(
    `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()
     RETURNING *`,
    [req.params.key, JSON.stringify(value), req.currentUser.id]
  );

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "update_setting", entityType: "system_setting", entityId: null,
    oldValues: existing.rows[0] ? { value: existing.rows[0].value } : null,
    newValues: { key: req.params.key, value }, ipAddress: req.ip,
  });

  res.json(rows[0]);
}));

module.exports = router;
