const express = require("express");
const { query, withTransaction } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");

const router = express.Router();

// Admissions follow the pipeline in spec section 12:
//   Inquiry -> Registration -> Verification -> Select Branch ->
//   Available Rooms/Beds -> Select Bed -> Registration Fee -> Security
//   Fee -> Confirmation -> Check-in
// This file covers everything up to and including Confirmation. Check-in
// itself (which actually creates the resident's active stay, occupies the
// bed permanently, and generates charges) is Phase 7 -- see
// db/POSTGRES_SCHEMA.md. Selecting a bed here only puts a hold on it
// (bed status -> 'reserved'); it isn't occupied until check-in.
router.use(requireRole("admin", "super_admin"));

// Which status an admission can move to next, from where. 'inquiry' only
// ever appears as the starting value set by POST /, never a target here.
// 'converted' is set exclusively by the (future) check-in transaction,
// never through this status endpoint.
const TRANSITIONS = {
  inquiry: ["registration", "cancelled"],
  registration: ["verification", "cancelled"],
  verification: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
};

function shapeAdmission(a) {
  return {
    id: a.id,
    fullName: a.full_name,
    phone: a.phone,
    cnic: a.cnic,
    branchId: a.branch_id,
    branchName: a.branch_name,
    bedId: a.bed_id,
    bedNumber: a.bed_number,
    roomNumber: a.room_number,
    roomType: a.room_type,
    registrationFee: a.registration_fee,
    securityFee: a.security_fee,
    status: a.status,
    residentId: a.resident_id,
    notes: a.notes,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

const ADMISSION_SELECT = `
  SELECT admissions.*, branches.name AS branch_name, beds.bed_number, rooms.room_number, rooms.room_type
  FROM admissions
  LEFT JOIN branches ON branches.id = admissions.branch_id
  LEFT JOIN beds ON beds.id = admissions.bed_id
  LEFT JOIN rooms ON rooms.id = beds.room_id
`;

router.get("/", asyncHandler(async (req, res) => {
  const { status, branch } = req.query;
  const conditions = [];
  const params = [];
  if (status && status !== "All") {
    params.push(status);
    conditions.push(`admissions.status = $${params.length}`);
  }
  if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`${ADMISSION_SELECT} ${where} ORDER BY admissions.created_at DESC LIMIT 500`, params);
  res.json(rows.map(shapeAdmission));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Admission not found." });
  res.json(shapeAdmission(rows[0]));
}));

// Step 1: Inquiry.
router.post("/", asyncHandler(async (req, res) => {
  const { fullName, phone, cnic, notes } = req.body || {};
  if (!fullName || !fullName.trim()) return res.status(400).json({ error: "fullName is required." });

  const { rows } = await query(
    `INSERT INTO admissions (full_name, phone, cnic, notes, created_by, status)
     VALUES ($1, $2, $3, $4, $5, 'inquiry') RETURNING id`,
    [fullName.trim(), phone || null, cnic || null, notes || null, req.currentUser.id]
  );
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "create_admission", entityType: "admission", entityId: rows[0].id,
    newValues: { fullName, phone, cnic }, ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [rows[0].id]);
  res.status(201).json(shapeAdmission(fullRows[0]));
}));

function requireOpenAdmission(admission, res) {
  if (!admission) {
    res.status(404).json({ error: "Admission not found." });
    return false;
  }
  // Once confirmed, an admission is locked except for the status endpoint
  // moving it to 'cancelled' (or, in Phase 7, check-in converting it) --
  // otherwise branch/bed/fees could be changed out from under a
  // confirmation that's already been acted on.
  if (["confirmed", "converted", "cancelled"].includes(admission.status)) {
    res.status(409).json({ error: `This admission is already ${admission.status} and can no longer be edited.` });
    return false;
  }
  return true;
}

// Editable contact/notes fields, and Step 5/6: Registration Fee / Security Fee.
router.patch("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await query("SELECT * FROM admissions WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!requireOpenAdmission(existing, res)) return;

  const body = req.body || {};
  const columnMap = {
    fullName: "full_name", phone: "phone", cnic: "cnic", notes: "notes",
    registrationFee: "registration_fee", securityFee: "security_fee",
  };
  const sets = [];
  const params = [];
  for (const [bodyKey, column] of Object.entries(columnMap)) {
    if (body[bodyKey] !== undefined) {
      params.push(body[bodyKey]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No editable fields were provided." });

  params.push(id);
  const { rows } = await query(`UPDATE admissions SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "update_admission", entityType: "admission", entityId: id,
    oldValues: existing, newValues: rows[0], ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [id]);
  res.json(shapeAdmission(fullRows[0]));
}));

// Step 4: Select Branch.
router.patch("/:id/branch", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { branchId } = req.body || {};
  const { rows: existingRows } = await query("SELECT * FROM admissions WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!requireOpenAdmission(existing, res)) return;

  const branch = await query("SELECT id FROM branches WHERE id = $1 AND status = 'active'", [branchId]);
  if (!branch.rows[0]) return res.status(400).json({ error: "That branch does not exist or is not active." });

  await withTransaction(async (client) => {
    // Changing branch after a bed was already held releases that hold --
    // a reserved bed only makes sense for the branch it's physically in.
    if (existing.bed_id) {
      await client.query("UPDATE beds SET status = 'available' WHERE id = $1 AND status = 'reserved'", [existing.bed_id]);
    }
    await client.query("UPDATE admissions SET branch_id = $1, bed_id = NULL WHERE id = $2", [branchId, id]);
  });

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "set_admission_branch", entityType: "admission", entityId: id,
    oldValues: { branchId: existing.branch_id }, newValues: { branchId }, ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [id]);
  res.json(shapeAdmission(fullRows[0]));
}));

// Step 5: Available Rooms/Beds -- only ever shows beds that are actually
// selectable right now (spec: "Only available beds should be selectable").
router.get("/:id/available-beds", asyncHandler(async (req, res) => {
  const { rows: admissionRows } = await query("SELECT * FROM admissions WHERE id = $1", [req.params.id]);
  const admission = admissionRows[0];
  if (!admission) return res.status(404).json({ error: "Admission not found." });
  if (!admission.branch_id) return res.status(400).json({ error: "Select a branch for this admission first." });

  const { rows } = await query(
    `SELECT beds.id, beds.bed_number, rooms.room_number, rooms.floor, rooms.room_type, rooms.bathroom_type, rooms.monthly_rent
     FROM beds JOIN rooms ON rooms.id = beds.room_id
     WHERE beds.branch_id = $1 AND beds.status = 'available'
     ORDER BY rooms.room_number, beds.bed_number`,
    [admission.branch_id]
  );
  res.json(rows);
}));

// Step 6: Select Bed. This only places a hold (bed -> 'reserved') so two
// admissions can't be steered toward the same bed while paperwork is in
// progress -- it does not create a resident or occupy the bed for real;
// that only happens at check-in (Phase 7).
router.patch("/:id/bed", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { bedId } = req.body || {};
  const { rows: existingRows } = await query("SELECT * FROM admissions WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!requireOpenAdmission(existing, res)) return;
  if (!existing.branch_id) return res.status(400).json({ error: "Select a branch for this admission first." });

  try {
    await withTransaction(async (client) => {
      // Re-check availability inside the transaction, immediately before
      // committing to it -- this is the race-condition protection the
      // spec calls for ("Backend must re-check availability immediately
      // before final admission/check-in"). FOR UPDATE locks the row so a
      // concurrent request selecting the same bed has to wait, then sees
      // it's no longer available.
      const { rows: bedRows } = await client.query("SELECT * FROM beds WHERE id = $1 FOR UPDATE", [bedId]);
      const bed = bedRows[0];
      if (!bed) throw Object.assign(new Error("Bed not found."), { statusCode: 404 });
      if (bed.branch_id !== existing.branch_id) {
        throw Object.assign(new Error("That bed is not in this admission's selected branch."), { statusCode: 400 });
      }
      if (bed.status !== "available") {
        throw Object.assign(new Error("That bed is no longer available -- someone else may have just selected it."), { statusCode: 409 });
      }

      // Release any bed this admission was previously holding.
      if (existing.bed_id) {
        await client.query("UPDATE beds SET status = 'available' WHERE id = $1 AND status = 'reserved'", [existing.bed_id]);
      }

      await client.query("UPDATE beds SET status = 'reserved' WHERE id = $1", [bedId]);
      await client.query("UPDATE admissions SET bed_id = $1 WHERE id = $2", [bedId, id]);
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return sendDbError(res, err);
  }

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "set_admission_bed", entityType: "admission", entityId: id,
    oldValues: { bedId: existing.bed_id }, newValues: { bedId }, ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [id]);
  res.json(shapeAdmission(fullRows[0]));
}));

// Advance (or cancel) the pipeline stage.
router.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const { rows: existingRows } = await query("SELECT * FROM admissions WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Admission not found." });

  const allowed = TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: `Cannot move from '${existing.status}' to '${status}'. Allowed next steps: ${allowed.join(", ") || "none"}.`,
    });
  }

  if (status === "confirmed") {
    const missing = [];
    if (!existing.branch_id) missing.push("branch");
    if (!existing.bed_id) missing.push("bed");
    if (existing.registration_fee == null) missing.push("registration fee");
    if (existing.security_fee == null) missing.push("security fee");
    if (missing.length) {
      return res.status(400).json({ error: `Cannot confirm -- still missing: ${missing.join(", ")}.` });
    }
  }

  await withTransaction(async (client) => {
    if (status === "cancelled" && existing.bed_id) {
      await client.query("UPDATE beds SET status = 'available' WHERE id = $1 AND status = 'reserved'", [existing.bed_id]);
    }
    await client.query("UPDATE admissions SET status = $1 WHERE id = $2", [status, id]);
  });

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_admission_status", entityType: "admission", entityId: id,
    oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${ADMISSION_SELECT} WHERE admissions.id = $1`, [id]);
  res.json(shapeAdmission(fullRows[0]));
}));

module.exports = router;
