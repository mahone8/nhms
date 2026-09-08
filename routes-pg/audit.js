const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");

const router = express.Router();

// Super Admin only -- this single line is the entire enforcement of
// "Admin MUST NOT be able to view Audit Logs" for this route. There is no
// separate "admin view" of this data; Admin's requests never pass
// requireRole here at all, regardless of headers, query params, or body.
router.use(requireRole("super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT audit_logs.*, users.username AS acting_username
     FROM audit_logs
     LEFT JOIN users ON audit_logs.user_id = users.id
     ORDER BY audit_logs.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
}));

module.exports = router;
