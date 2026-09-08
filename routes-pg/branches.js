const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");
const { computeBranchEarnings } = require("../lib/earnings");

const router = express.Router();

// Both Admin and Super Admin can view branches (needed for day-to-day
// operations); only Super Admin can create/edit/activate/deactivate one --
// see section 6 ("Super Admin can: Create branches... Activate/deactivate
// branches...") vs section 7's Admin capability list, which does not
// include creating or deactivating branches at all.
router.use(requireRole("admin", "super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT
      b.*,
      COUNT(bd.id) FILTER (WHERE bd.id IS NOT NULL) AS total_beds,
      COUNT(bd.id) FILTER (WHERE bd.status = 'occupied') AS occupied_beds,
      COUNT(bd.id) FILTER (WHERE bd.status = 'available') AS available_beds,
      COUNT(bd.id) FILTER (WHERE bd.status = 'reserved') AS reserved_beds
    FROM branches b
    LEFT JOIN beds bd ON bd.branch_id = b.id
    GROUP BY b.id
    ORDER BY b.id
  `);
  res.json(rows);
}));

// Registered BEFORE "/:id" -- "earnings" would otherwise match ":id" as
// its param value (Express doesn't distinguish a literal path from a
// param path by content, only by registration order), the same ordering
// trap documented in RENT_CHARGES.md and PAYMENTS_RECEIPTS.md, just
// within a single file this time instead of across two.
router.get("/earnings", asyncHandler(async (req, res) => {
  const { rows: branches } = await query("SELECT id, name FROM branches ORDER BY id");
  const earnings = await Promise.all(
    branches.map(async (b) => ({ branchId: b.id, branchName: b.name, ...(await computeBranchEarnings(b.id)) }))
  );
  res.json(earnings);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM branches WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Branch not found." });
  res.json(rows[0]);
}));

// Spec section 23: per-branch revenue/expenses/net income/outstanding
// dues, computed from actual payments collected (never from charges
// generated) -- see lib/earnings.js for the exact formula and reasoning.
router.get("/:id/earnings", asyncHandler(async (req, res) => {
  const branch = await query("SELECT id, name FROM branches WHERE id = $1", [req.params.id]);
  if (!branch.rows[0]) return res.status(404).json({ error: "Branch not found." });
  res.json({ branchId: branch.rows[0].id, branchName: branch.rows[0].name, ...(await computeBranchEarnings(req.params.id)) });
}));

router.post("/", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const { name, address, contact, capacity } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required." });

  try {
    const { rows } = await query(
      "INSERT INTO branches (name, address, contact, capacity) VALUES ($1, $2, $3, $4) RETURNING *",
      [name.trim(), address || null, contact || null, Number(capacity) || 36]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "create_branch", entityType: "branch", entityId: rows[0].id,
      newValues: rows[0], ipAddress: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await query("SELECT * FROM branches WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Branch not found." });

  const name = req.body?.name?.trim() ?? existing.name;
  const address = req.body?.address ?? existing.address;
  const contact = req.body?.contact ?? existing.contact;
  const capacity = req.body?.capacity != null ? Number(req.body.capacity) : existing.capacity;

  try {
    const { rows } = await query(
      "UPDATE branches SET name = $1, address = $2, contact = $3, capacity = $4 WHERE id = $5 RETURNING *",
      [name, address, contact, capacity, id]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "update_branch", entityType: "branch", entityId: id,
      oldValues: existing, newValues: rows[0], ipAddress: req.ip,
    });
    res.json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id/status", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status must be active or inactive." });
  }
  const { rows: existingRows } = await query("SELECT * FROM branches WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Branch not found." });

  const { rows } = await query("UPDATE branches SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_branch_status", entityType: "branch", entityId: id,
    oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip,
  });
  res.json(rows[0]);
}));

module.exports = router;
