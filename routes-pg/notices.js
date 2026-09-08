const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { logAction } = require("../lib/audit");

const router = express.Router();

/**
 * Resident's own notices (spec section 27): general (target_type='all'),
 * their branch's, and ones aimed specifically at them -- active and not
 * expired. Scoped by req.currentUser's own resident_id/branch_id, never
 * by anything read from the request, same IDOR pattern used throughout
 * (Phases 9, 10, 17).
 */
router.get("/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows: residentRows } = await query("SELECT branch_id FROM residents WHERE user_id = $1", [req.currentUser.id]);
  if (!residentRows[0]) return res.json([]);
  const { branch_id: branchId } = residentRows[0];

  const { rows } = await query(
    `SELECT notices.* FROM notices
     JOIN residents ON residents.user_id = $1
     WHERE notices.status = 'active'
       AND (notices.expiry_date IS NULL OR notices.expiry_date >= CURRENT_DATE)
       AND (
         notices.target_type = 'all' OR
         (notices.target_type = 'branch' AND notices.target_branch_id = $2) OR
         (notices.target_type = 'resident' AND notices.target_resident_id = residents.id)
       )
     ORDER BY notices.created_at DESC LIMIT 100`,
    [req.currentUser.id, branchId]
  );
  res.json(rows);
}));

router.use(requireRole("admin", "super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const { status, targetType, branch } = req.query;
  const conditions = [];
  const params = [];
  if (status && status !== "All") { params.push(status); conditions.push(`notices.status = $${params.length}`); }
  if (targetType && targetType !== "All") { params.push(targetType); conditions.push(`notices.target_type = $${params.length}`); }
  if (branch) { params.push(branch); conditions.push(`branches.name = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await query(
    `SELECT notices.*, branches.name AS target_branch_name, residents.full_name AS target_resident_name, users.name AS created_by_name
     FROM notices
     LEFT JOIN branches ON branches.id = notices.target_branch_id
     LEFT JOIN residents ON residents.id = notices.target_resident_id
     LEFT JOIN users ON users.id = notices.created_by
     ${where} ORDER BY notices.created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { title, message, targetType, targetBranchId, targetResidentId, expiryDate } = req.body || {};

  if (!title || !title.trim() || !message || !message.trim()) {
    return res.status(400).json({ error: "title and message are required." });
  }
  if (!["all", "branch", "resident"].includes(targetType)) {
    return res.status(400).json({ error: "targetType must be all, branch, or resident." });
  }
  // Mirrors the exact CHECK constraint on the notices table (migration
  // 013) -- validated here too so a bad combination gets a clear 400
  // instead of a raw constraint-violation 500.
  if (targetType === "branch" && !targetBranchId) return res.status(400).json({ error: "targetBranchId is required when targetType is branch." });
  if (targetType === "resident" && !targetResidentId) return res.status(400).json({ error: "targetResidentId is required when targetType is resident." });
  if (targetType === "all" && (targetBranchId || targetResidentId)) return res.status(400).json({ error: "targetBranchId/targetResidentId must not be set when targetType is all." });

  if (targetType === "branch") {
    const branch = await query("SELECT id FROM branches WHERE id = $1", [targetBranchId]);
    if (!branch.rows[0]) return res.status(400).json({ error: "That branch does not exist." });
  }
  if (targetType === "resident") {
    const resident = await query("SELECT id FROM residents WHERE id = $1", [targetResidentId]);
    if (!resident.rows[0]) return res.status(400).json({ error: "That resident does not exist." });
  }

  const { rows } = await query(
    `INSERT INTO notices (title, message, target_type, target_branch_id, target_resident_id, created_by, expiry_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING *`,
    [
      title.trim(), message.trim(), targetType,
      targetType === "branch" ? targetBranchId : null,
      targetType === "resident" ? targetResidentId : null,
      req.currentUser.id, expiryDate || null,
    ]
  );

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "create_notice", entityType: "notice", entityId: rows[0].id,
    newValues: rows[0], ipAddress: req.ip,
  });

  res.status(201).json(rows[0]);
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "expired", "archived"].includes(status)) {
    return res.status(400).json({ error: "status must be active, expired, or archived." });
  }
  const existing = await query("SELECT * FROM notices WHERE id = $1", [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Notice not found." });

  const { rows } = await query("UPDATE notices SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_notice_status", entityType: "notice", entityId: Number(req.params.id),
    oldValues: { status: existing.rows[0].status }, newValues: { status }, ipAddress: req.ip,
  });
  res.json(rows[0]);
}));

module.exports = router;
