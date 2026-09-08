const express = require("express");
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");
const { computeDues, CHARGE_TYPES } = require("../lib/dues");

const router = express.Router();

// Fields a resident's own request is allowed to be scoped by; everything
// else about a resident (edits, status changes, listing others) is
// Admin/Super Admin only -- see requireRole calls below, applied per
// route rather than router-wide so /me can stay reachable to residents.
const PERSONAL_FIELDS = ["full_name", "father_guardian_name", "cnic", "date_of_birth", "phone", "emergency_contact", "permanent_address"];
const EDUCATION_FIELDS = ["university", "department", "student_id", "program", "semester_year"];

function shapeResident(r) {
  return {
    id: r.id,
    userId: r.user_id,
    branchId: r.branch_id,
    branchName: r.branch_name,
    roomId: r.room_id,
    roomNumber: r.room_number,
    floor: r.floor,
    roomType: r.room_type,
    bathroomType: r.bathroom_type,
    monthlyRent: r.monthly_rent,
    bedId: r.bed_id,
    bedNumber: r.bed_number,
    fullName: r.full_name,
    fatherGuardianName: r.father_guardian_name,
    cnic: r.cnic,
    dateOfBirth: r.date_of_birth,
    phone: r.phone,
    emergencyContact: r.emergency_contact,
    permanentAddress: r.permanent_address,
    university: r.university,
    department: r.department,
    studentId: r.student_id,
    program: r.program,
    semesterYear: r.semester_year,
    joiningDate: r.joining_date,
    expectedCheckoutDate: r.expected_checkout_date,
    status: r.status,
    username: r.username,
  };
}

const RESIDENT_SELECT = `
  SELECT residents.*, branches.name AS branch_name,
         rooms.room_number, rooms.floor, rooms.room_type, rooms.bathroom_type, rooms.monthly_rent,
         beds.bed_number, users.username
  FROM residents
  JOIN branches ON branches.id = residents.branch_id
  LEFT JOIN rooms ON rooms.id = residents.room_id
  LEFT JOIN beds ON beds.id = residents.bed_id
  LEFT JOIN users ON users.id = residents.user_id
`;

// --- Resident's own record -------------------------------------------------
// Must be defined before the admin-only routes below and must NEVER accept
// a resident id from the client -- the id comes only from req.currentUser,
// which is loaded server-side from the verified session (lib/rbac.js).
// This is the IDOR protection the spec calls for in section 9: a resident
// cannot reach another resident's data by editing an ID, because no ID is
// ever read from the request for this route.
router.get("/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows } = await query(`${RESIDENT_SELECT} WHERE residents.user_id = $1`, [req.currentUser.id]);
  if (!rows[0]) return res.status(404).json({ error: "No resident profile is linked to this account yet." });
  res.json(shapeResident(rows[0]));
}));

// Must be registered here, before the blanket admin/super_admin gate
// below -- that gate is a router.use() with no path restriction, so it
// would otherwise intercept this path too (Express applies an unscoped
// router.use() to every request under this router's mount, regardless of
// whether any specific route pattern matches -- this bit us once during
// Phase 9 testing when this route briefly lived in a separately-mounted
// file at the same path and got a mysterious 403 instead of ever
// executing).
router.get("/me/dues", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id FROM residents WHERE user_id = $1", [req.currentUser.id]);
  if (!rows[0]) return res.status(404).json({ error: "No resident profile is linked to this account yet." });
  res.json(await computeDues(rows[0].id));
}));

// Phase 19 (Resident Portal): "Stay Information" needs the resident's own
// history. Registered here, before the admin gate below, for the same
// reason /me and /me/dues are -- see the comment on /me/dues above and
// RENT_CHARGES.md for the router.use() interception this avoids.
router.get("/me/stay-history", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows: residentRows } = await query("SELECT id FROM residents WHERE user_id = $1", [req.currentUser.id]);
  if (!residentRows[0]) return res.status(404).json({ error: "No resident profile is linked to this account yet." });

  const { rows } = await query(
    `SELECT resident_assignments.*, branches.name AS branch_name, rooms.room_number, rooms.room_type, beds.bed_number
     FROM resident_assignments
     JOIN branches ON branches.id = resident_assignments.branch_id
     JOIN rooms ON rooms.id = resident_assignments.room_id
     JOIN beds ON beds.id = resident_assignments.bed_id
     WHERE resident_assignments.resident_id = $1
     ORDER BY resident_assignments.start_date ASC, resident_assignments.id ASC`,
    [residentRows[0].id]
  );
  res.json(rows.map((r) => ({
    branchName: r.branch_name, roomNumber: r.room_number, roomType: r.room_type, bedNumber: r.bed_number,
    startDate: r.start_date, endDate: r.end_date, rentAtAssignment: r.rent_at_assignment, reason: r.reason, notes: r.notes,
  })));
}));

// --- Admin / Super Admin: full resident management -------------------------
router.use(requireRole("admin", "super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const { branch, status, q } = req.query;
  const conditions = [];
  const params = [];

  if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  if (status && status !== "All") {
    params.push(status);
    conditions.push(`residents.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(residents.full_name ILIKE $${params.length} OR residents.cnic ILIKE $${params.length} OR residents.phone ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`${RESIDENT_SELECT} ${where} ORDER BY residents.full_name LIMIT 500`, params);
  res.json(rows.map(shapeResident));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query(`${RESIDENT_SELECT} WHERE residents.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Resident not found." });
  res.json(shapeResident(rows[0]));
}));

router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.fullName || !body.fullName.trim()) return res.status(400).json({ error: "fullName is required." });
  if (!body.branchId) return res.status(400).json({ error: "branchId is required." });
  if (!body.joiningDate) return res.status(400).json({ error: "joiningDate is required." });

  const branch = await query("SELECT id FROM branches WHERE id = $1", [body.branchId]);
  if (!branch.rows[0]) return res.status(400).json({ error: "That branch does not exist." });

  // Creating a login here is optional -- a resident can exist (e.g. during
  // admissions, before they're ready to log in) without one, and one can
  // be added or changed later via PATCH /:id/account.
  if (body.username) {
    const existing = await query("SELECT id FROM users WHERE username = $1", [body.username]);
    if (existing.rows.length) return res.status(409).json({ error: "That username is already taken." });
    if (!body.password) return res.status(400).json({ error: "password is required when username is provided." });
  }

  try {
    const resident = await withTransaction(async (client) => {
      let userId = null;
      if (body.username) {
        const passwordHash = bcrypt.hashSync(body.password, 10);
        const { rows: userRows } = await client.query(
          "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, 'resident') RETURNING id",
          [body.fullName.trim(), body.username, passwordHash]
        );
        userId = userRows[0].id;
      }

      // Resident is created without a bed/room -- assigning one is the
      // check-in workflow's job (Phase 7), which is also what will move
      // status from 'reserved' to 'active'.
      const { rows } = await client.query(
        `INSERT INTO residents (
           user_id, branch_id, full_name, father_guardian_name, cnic, date_of_birth,
           phone, emergency_contact, permanent_address, university, department,
           student_id, program, semester_year, joining_date, expected_checkout_date, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'reserved')
         RETURNING id`,
        [
          userId, body.branchId, body.fullName.trim(), body.fatherGuardianName || null, body.cnic || null,
          body.dateOfBirth || null, body.phone || null, body.emergencyContact || null, body.permanentAddress || null,
          body.university || null, body.department || null, body.studentId || null, body.program || null,
          body.semesterYear || null, body.joiningDate, body.expectedCheckoutDate || null,
        ]
      );
      return rows[0];
    });

    const { rows: fullRows } = await query(`${RESIDENT_SELECT} WHERE residents.id = $1`, [resident.id]);
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "create_resident", entityType: "resident", entityId: resident.id,
      newValues: shapeResident(fullRows[0]), ipAddress: req.ip,
    });
    res.status(201).json(shapeResident(fullRows[0]));
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await query("SELECT * FROM residents WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Resident not found." });

  const body = req.body || {};
  const columnMap = {
    fullName: "full_name", fatherGuardianName: "father_guardian_name", cnic: "cnic",
    dateOfBirth: "date_of_birth", phone: "phone", emergencyContact: "emergency_contact",
    permanentAddress: "permanent_address", university: "university", department: "department",
    studentId: "student_id", program: "program", semesterYear: "semester_year",
    expectedCheckoutDate: "expected_checkout_date",
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
  try {
    const { rows } = await query(`UPDATE residents SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    const { rows: fullRows } = await query(`${RESIDENT_SELECT} WHERE residents.id = $1`, [id]);
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "update_resident", entityType: "resident", entityId: id,
      oldValues: existing, newValues: rows[0], ipAddress: req.ip,
    });
    res.json(shapeResident(fullRows[0]));
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  // 'active' and 'checked_out' are deliberately not settable here -- they
  // are set automatically by the check-in and check-out workflows
  // (Phases 7-8), which also handle the bed assignment/release that gives
  // those statuses meaning. This endpoint only covers a manual hold
  // ('suspended') and reverting one.
  if (!["reserved", "suspended"].includes(status)) {
    return res.status(400).json({
      error: "status must be reserved or suspended here. Active/checked_out are set automatically by check-in and check-out.",
    });
  }

  const { rows: existingRows } = await query("SELECT * FROM residents WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "Resident not found." });
  if (existing.status === "active" || existing.status === "checked_out") {
    return res.status(409).json({
      error: `Cannot change status from '${existing.status}' here -- use check-out to end an active stay.`,
    });
  }

  await query("UPDATE residents SET status = $1 WHERE id = $2", [status, id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_resident_status", entityType: "resident", entityId: id,
    oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip,
  });
  const { rows: fullRows } = await query(`${RESIDENT_SELECT} WHERE residents.id = $1`, [id]);
  res.json(shapeResident(fullRows[0]));
}));

router.patch("/:id/account", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username and password are required." });

  const { rows: residentRows } = await query("SELECT * FROM residents WHERE id = $1", [id]);
  const resident = residentRows[0];
  if (!resident) return res.status(404).json({ error: "Resident not found." });

  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    if (resident.user_id) {
      const existing = await query("SELECT id FROM users WHERE username = $1 AND id != $2", [username, resident.user_id]);
      if (existing.rows.length) return res.status(409).json({ error: "That username is already taken." });
      await query("UPDATE users SET username = $1, password_hash = $2 WHERE id = $3", [username, passwordHash, resident.user_id]);
    } else {
      const existing = await query("SELECT id FROM users WHERE username = $1", [username]);
      if (existing.rows.length) return res.status(409).json({ error: "That username is already taken." });
      const { rows: userRows } = await query(
        "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, 'resident') RETURNING id",
        [resident.full_name, username, passwordHash]
      );
      await query("UPDATE residents SET user_id = $1 WHERE id = $2", [userRows[0].id, id]);
    }

    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "set_resident_account", entityType: "resident", entityId: id,
      newValues: { username }, ipAddress: req.ip,
    });

    const { rows: fullRows } = await query(`${RESIDENT_SELECT} WHERE residents.id = $1`, [id]);
    res.json(shapeResident(fullRows[0]));
  } catch (err) {
    sendDbError(res, err);
  }
}));

// The rest of Phase 9 (Rent/Charges): both routes below sit after the
// admin/super_admin gate above, so no ordering concern applies to them.
router.get("/:id/dues", asyncHandler(async (req, res) => {
  const resident = await query("SELECT id FROM residents WHERE id = $1", [req.params.id]);
  if (!resident.rows[0]) return res.status(404).json({ error: "Resident not found." });
  res.json(await computeDues(req.params.id));
}));

// Manually add a one-off charge, discount, or adjustment. Monthly rent,
// security fee, and registration fee can also be added here for
// corrections, but their normal path is automatic (check-in for the
// first of each, the monthly rent job in Phase 11 for every month after).
router.post("/:id/charges", asyncHandler(async (req, res) => {
  const residentId = Number(req.params.id);
  const { type, amount, dueDate, description } = req.body || {};

  if (!CHARGE_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${CHARGE_TYPES.join(", ")}` });
  }
  if (amount == null || Number.isNaN(Number(amount)) || Number(amount) === 0) {
    return res.status(400).json({ error: "amount must be a non-zero number." });
  }

  const { rows: residentRows } = await query("SELECT * FROM residents WHERE id = $1", [residentId]);
  const resident = residentRows[0];
  if (!resident) return res.status(404).json({ error: "Resident not found." });

  const { rows } = await query(
    `INSERT INTO charges (resident_id, branch_id, type, amount, due_date, status, description)
     VALUES ($1, $2, $3, $4, $5, 'due', $6) RETURNING *`,
    [residentId, resident.branch_id, type, Number(amount), dueDate || null, description || null]
  );

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "add_charge", entityType: "charge", entityId: rows[0].id,
    newValues: rows[0], ipAddress: req.ip,
  });

  res.status(201).json(rows[0]);
}));

module.exports = router;
