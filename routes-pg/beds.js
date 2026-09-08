const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");

const router = express.Router();

router.use(requireRole("admin", "super_admin"));

router.get("/room/:roomId", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM beds WHERE room_id = $1 ORDER BY bed_number", [req.params.roomId]);
  res.json(rows);
}));

// Bed-grid convenience: every bed in a branch, with its room's details and
// (once Phase 5+ exists) its resident, in one call.
router.get("/branch/:branchId", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT beds.*, rooms.room_number, rooms.room_type, rooms.bathroom_type, rooms.monthly_rent, rooms.floor
     FROM beds
     JOIN rooms ON rooms.id = beds.room_id
     WHERE beds.branch_id = $1
     ORDER BY rooms.room_number, beds.bed_number`,
    [req.params.branchId]
  );
  res.json(rows);
}));

router.post("/room/:roomId", asyncHandler(async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { bedNumber } = req.body || {};
  if (!bedNumber || Number(bedNumber) <= 0) {
    return res.status(400).json({ error: "bedNumber must be a positive number." });
  }

  const room = await query("SELECT id FROM rooms WHERE id = $1", [roomId]);
  if (!room.rows[0]) return res.status(404).json({ error: "Room not found." });

  try {
    // branch_id is derived from the room here, and re-validated/enforced
    // by triggers (migration 005) either way -- room/branch capacity
    // limits are checked at the database level, not just in this route.
    const { rows } = await query(
      `INSERT INTO beds (branch_id, room_id, bed_number)
       VALUES ((SELECT branch_id FROM rooms WHERE id = $1), $1, $2) RETURNING *`,
      [roomId, Number(bedNumber)]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "create_bed", entityType: "bed", entityId: rows[0].id,
      newValues: rows[0], ipAddress: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  // 'occupied' is deliberately not settable through this endpoint. A bed
  // only becomes occupied as a side effect of the check-in workflow
  // (Phase 7), which also creates the resident_assignments row that makes
  // sense of it. Allowing it here would let someone mark a bed occupied
  // with no resident behind it at all.
  if (!["available", "reserved"].includes(status)) {
    return res.status(400).json({
      error: "status must be available or reserved here. Occupied is set automatically during check-in.",
    });
  }

  const { rows: existingRows } = await query("SELECT * FROM beds WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Bed not found." });
  if (existing.status === "occupied") {
    return res.status(409).json({ error: "This bed is currently occupied. Check the resident out or transfer them first." });
  }

  const { rows } = await query("UPDATE beds SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_bed_status", entityType: "bed", entityId: id,
    oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip,
  });
  res.json(rows[0]);
}));

module.exports = router;
