const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");

const router = express.Router();

// Admin has full room management, same as Super Admin -- section 7 lists
// "Manage rooms" directly under Admin's capabilities (unlike branch
// creation/deactivation, which is Super-Admin-only -- see branches.js).
router.use(requireRole("admin", "super_admin"));

router.get("/branch/:branchId", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT rooms.*, COUNT(beds.id) AS bed_count,
            COUNT(beds.id) FILTER (WHERE beds.status = 'occupied') AS occupied_count
     FROM rooms
     LEFT JOIN beds ON beds.room_id = rooms.id
     WHERE rooms.branch_id = $1
     GROUP BY rooms.id
     ORDER BY rooms.room_number`,
    [req.params.branchId]
  );
  res.json(rows);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM rooms WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Room not found." });
  res.json(rows[0]);
}));

const ROOM_TYPES = ["1 Seater", "2 Seater", "3 Seater", "4 Seater"];
const BATHROOM_TYPES = ["Attached Bath", "Common Bath"];

router.post("/branch/:branchId", asyncHandler(async (req, res) => {
  const branchId = Number(req.params.branchId);
  const { roomNumber, floor, roomType, bathroomType, monthlyRent } = req.body || {};

  if (!roomNumber || !roomNumber.toString().trim()) {
    return res.status(400).json({ error: "roomNumber is required." });
  }
  if (!ROOM_TYPES.includes(roomType)) {
    return res.status(400).json({ error: `roomType must be one of: ${ROOM_TYPES.join(", ")}` });
  }
  if (!BATHROOM_TYPES.includes(bathroomType)) {
    return res.status(400).json({ error: `bathroomType must be one of: ${BATHROOM_TYPES.join(", ")}` });
  }
  if (monthlyRent == null || Number(monthlyRent) < 0) {
    return res.status(400).json({ error: "monthlyRent must be a non-negative number." });
  }

  const branch = await query("SELECT id FROM branches WHERE id = $1", [branchId]);
  if (!branch.rows[0]) return res.status(404).json({ error: "Branch not found." });

  try {
    // capacity is intentionally not accepted from the client -- a trigger
    // (migration 004) derives it from roomType automatically.
    const { rows } = await query(
      `INSERT INTO rooms (branch_id, room_number, floor, room_type, bathroom_type, capacity, monthly_rent)
       VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING *`,
      [branchId, roomNumber.toString().trim(), floor || null, roomType, bathroomType, Number(monthlyRent)]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "create_room", entityType: "room", entityId: rows[0].id,
      newValues: rows[0], ipAddress: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await query("SELECT * FROM rooms WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Room not found." });

  const roomNumber = req.body?.roomNumber?.toString().trim() ?? existing.room_number;
  const floor = req.body?.floor ?? existing.floor;
  const roomType = req.body?.roomType ?? existing.room_type;
  const bathroomType = req.body?.bathroomType ?? existing.bathroom_type;
  const monthlyRent = req.body?.monthlyRent != null ? Number(req.body.monthlyRent) : existing.monthly_rent;

  if (!ROOM_TYPES.includes(roomType)) {
    return res.status(400).json({ error: `roomType must be one of: ${ROOM_TYPES.join(", ")}` });
  }
  if (!BATHROOM_TYPES.includes(bathroomType)) {
    return res.status(400).json({ error: `bathroomType must be one of: ${BATHROOM_TYPES.join(", ")}` });
  }

  try {
    const { rows } = await query(
      `UPDATE rooms SET room_number = $1, floor = $2, room_type = $3, bathroom_type = $4, monthly_rent = $5
       WHERE id = $6 RETURNING *`,
      [roomNumber, floor, roomType, bathroomType, monthlyRent, id]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "update_room", entityType: "room", entityId: id,
      oldValues: existing, newValues: rows[0], ipAddress: req.ip,
    });
    res.json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["active", "inactive", "maintenance"].includes(status)) {
    return res.status(400).json({ error: "status must be active, inactive, or maintenance." });
  }
  const { rows: existingRows } = await query("SELECT * FROM rooms WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Room not found." });

  const { rows } = await query("UPDATE rooms SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_room_status", entityType: "room", entityId: id,
    oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip,
  });
  res.json(rows[0]);
}));

module.exports = router;
