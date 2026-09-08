const express = require("express");
const { query, withTransaction } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");

const router = express.Router();
// NOTE: this router is mounted at bare "/api" alongside several other
// files sharing that same root -- see the identical note in
// checkin-checkout.js, which explains why a path-less
// router.use(requireRole(...)) here would silently break resident-facing
// routes in files registered afterward. Each route below applies
// requireRole(...) individually instead.

/**
 * Transfer (spec section 15). Moves an active resident to a different
 * bed -- which, since a bed belongs to exactly one room and one branch,
 * covers "Transfer can change: Branch, Room, Bed" with a single
 * destination parameter. Runs as one transaction:
 *   - validates the destination (branch active, room active, bed exists)
 *   - verifies the destination bed is actually available right now
 *     (SELECT ... FOR UPDATE, same race-condition discipline as check-in)
 *   - closes the current resident_assignments row (end_date = transfer date)
 *   - opens a new one (reason: 'transfer', with its own notes)
 *   - releases the old bed, occupies the new one
 *   - updates the resident's current branch/room/bed
 * The closed assignment row's branch/room/bed values are never rewritten
 * -- "Preserve historical branch/room/bed" holds by construction, since
 * this only ever inserts a new row and sets end_date on the old one.
 */
router.post("/transfers", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { residentId, bedId, transferDate, reason } = req.body || {};
  if (!residentId || !bedId) return res.status(400).json({ error: "residentId and bedId are required." });
  const date = transferDate || new Date().toISOString().slice(0, 10);

  let result;
  try {
    result = await withTransaction(async (client) => {
      const { rows: residentRows } = await client.query("SELECT * FROM residents WHERE id = $1 FOR UPDATE", [residentId]);
      const resident = residentRows[0];
      if (!resident) throw Object.assign(new Error("Resident not found."), { statusCode: 404 });
      if (resident.status !== "active") {
        throw Object.assign(new Error(`This resident is '${resident.status}', not 'active' -- only an active resident can be transferred.`), { statusCode: 400 });
      }
      // node-pg returns bigint columns as strings, so compare numerically
      // rather than with strict equality (which would never match here).
      if (Number(resident.bed_id) === Number(bedId)) {
        throw Object.assign(new Error("That is this resident's current bed -- choose a different destination."), { statusCode: 400 });
      }

      // Validate + verify the destination, locked against concurrent transfers/check-ins.
      const { rows: bedRows } = await client.query("SELECT * FROM beds WHERE id = $1 FOR UPDATE", [bedId]);
      const destBed = bedRows[0];
      if (!destBed) throw Object.assign(new Error("Destination bed not found."), { statusCode: 404 });
      if (destBed.status !== "available") {
        throw Object.assign(new Error("The destination bed is not available."), { statusCode: 409 });
      }

      const { rows: roomRows } = await client.query("SELECT * FROM rooms WHERE id = $1", [destBed.room_id]);
      const destRoom = roomRows[0];
      if (destRoom.status !== "active") {
        throw Object.assign(new Error("The destination room is not active."), { statusCode: 400 });
      }
      const { rows: branchRows } = await client.query("SELECT * FROM branches WHERE id = $1", [destBed.branch_id]);
      const destBranch = branchRows[0];
      if (destBranch.status !== "active") {
        throw Object.assign(new Error("The destination branch is not active."), { statusCode: 400 });
      }

      const { rows: openAssignmentRows } = await client.query(
        "SELECT * FROM resident_assignments WHERE resident_id = $1 AND end_date IS NULL FOR UPDATE",
        [residentId]
      );
      const openAssignment = openAssignmentRows[0];
      if (!openAssignment) throw Object.assign(new Error("No open stay-history record was found for this resident."), { statusCode: 409 });

      // Close the old assignment -- historical branch/room/bed on this
      // row are left exactly as they were, only end_date is set.
      await client.query("UPDATE resident_assignments SET end_date = $1 WHERE id = $2", [date, openAssignment.id]);

      // Release the old bed, occupy the new one.
      await client.query("UPDATE beds SET status = 'available' WHERE id = $1", [resident.bed_id]);
      await client.query("UPDATE beds SET status = 'occupied' WHERE id = $1", [bedId]);

      await client.query(
        `INSERT INTO resident_assignments (resident_id, branch_id, room_id, bed_id, start_date, rent_at_assignment, reason, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'transfer', $7)`,
        [residentId, destBed.branch_id, destBed.room_id, bedId, date, destRoom.monthly_rent, reason || null]
      );

      await client.query(
        "UPDATE residents SET branch_id = $1, room_id = $2, bed_id = $3 WHERE id = $4",
        [destBed.branch_id, destBed.room_id, bedId, residentId]
      );

      return {
        fromBranchId: resident.branch_id, fromRoomId: resident.room_id, fromBedId: resident.bed_id,
        toBranchId: destBed.branch_id, toRoomId: destBed.room_id, toBedId: bedId,
      };
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return sendDbError(res, err);
  }

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "transfer_resident", entityType: "resident", entityId: Number(residentId),
    oldValues: { branchId: result.fromBranchId, roomId: result.fromRoomId, bedId: result.fromBedId },
    newValues: { branchId: result.toBranchId, roomId: result.toRoomId, bedId: result.toBedId },
    metadata: { transferDate: date, reason: reason || null },
    ipAddress: req.ip,
  });

  const { rows } = await query(
    `SELECT residents.*, branches.name AS branch_name, rooms.room_number, rooms.room_type, beds.bed_number
     FROM residents
     JOIN branches ON branches.id = residents.branch_id
     JOIN rooms ON rooms.id = residents.room_id
     JOIN beds ON beds.id = residents.bed_id
     WHERE residents.id = $1`,
    [residentId]
  );
  res.json(rows[0]);
}));

/**
 * Full stay history for a resident (spec section 16) -- every
 * resident_assignments row, oldest first, with branch/room/bed names
 * resolved for readability. Nothing here is ever overwritten by a
 * transfer or check-out; this is simply a read of what's already
 * permanently recorded.
 *
 * NOTE: same caveat as checkin-checkout.js's checkout-preview route --
 * this only works because it requires the same role as residents.js's
 * blanket gate. See that file's comment for the full explanation. Any
 * future resident-facing route under "/residents/..." belongs in
 * residents.js itself.
 */
router.get("/residents/:id/stay-history", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const resident = await query("SELECT id FROM residents WHERE id = $1", [req.params.id]);
  if (!resident.rows[0]) return res.status(404).json({ error: "Resident not found." });

  const { rows } = await query(
    `SELECT resident_assignments.*, branches.name AS branch_name, rooms.room_number, rooms.room_type, beds.bed_number
     FROM resident_assignments
     JOIN branches ON branches.id = resident_assignments.branch_id
     JOIN rooms ON rooms.id = resident_assignments.room_id
     JOIN beds ON beds.id = resident_assignments.bed_id
     WHERE resident_assignments.resident_id = $1
     ORDER BY resident_assignments.start_date ASC, resident_assignments.id ASC`,
    [req.params.id]
  );
  res.json(rows.map((r) => ({
    id: r.id,
    branchName: r.branch_name,
    roomNumber: r.room_number,
    roomType: r.room_type,
    bedNumber: r.bed_number,
    startDate: r.start_date,
    endDate: r.end_date,
    rentAtAssignment: r.rent_at_assignment,
    reason: r.reason,
    notes: r.notes,
    createdAt: r.created_at,
  })));
}));

module.exports = router;
