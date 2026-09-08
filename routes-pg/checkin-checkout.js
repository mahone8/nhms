const express = require("express");
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");
const { computeDues } = require("../lib/dues");

const router = express.Router();
// NOTE: this router is mounted at bare "/api" (see app.js), alongside
// several other files sharing that same root. A path-less
// router.use(requireRole(...)) here would intercept EVERY /api/* request
// that reaches this router in Express's middleware chain -- not just
// requests actually matching one of the routes below -- which silently
// broke resident-facing routes registered in files mounted after this
// one (found while testing Phase 10's /api/payments/me). Each route
// below applies requireRole(...) individually instead.

function pad(n) { return String(n).padStart(2, "0"); }
function monthKeyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function monthLabelOf(d) { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }

/**
 * Step "Check-in" (spec section 13). Takes a confirmed admission and:
 *   - creates the resident record (Active, with the admission's chosen
 *     branch/room/bed)
 *   - flips the bed from 'reserved' to 'occupied'
 *   - opens the first resident_assignments row (reason: 'check_in')
 *   - generates registration fee, security fee, and first month's rent
 *     as charges
 *   - marks the admission 'converted', linked to the new resident
 *
 * Everything above happens in one transaction -- spec: "The final
 * check-in operation must be transactional" and "Prevent race conditions
 * that could assign the same bed to multiple residents." The bed's
 * status is re-checked with SELECT ... FOR UPDATE inside the transaction,
 * the same race-condition protection used when the bed was first reserved
 * in Phase 6.
 */
router.post("/check-in", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { admissionId, joiningDate, username, password } = req.body || {};
  if (!admissionId) return res.status(400).json({ error: "admissionId is required." });

  const checkInDate = joiningDate || new Date().toISOString().slice(0, 10);

  if (username && !password) {
    return res.status(400).json({ error: "password is required when username is provided." });
  }
  if (username) {
    const existing = await query("SELECT id FROM users WHERE username = $1", [username]);
    if (existing.rows.length) return res.status(409).json({ error: "That username is already taken." });
  }

  let result;
  try {
    result = await withTransaction(async (client) => {
      const { rows: admissionRows } = await client.query("SELECT * FROM admissions WHERE id = $1 FOR UPDATE", [admissionId]);
      const admission = admissionRows[0];
      if (!admission) throw Object.assign(new Error("Admission not found."), { statusCode: 404 });
      if (admission.status !== "confirmed") {
        throw Object.assign(new Error(`This admission is '${admission.status}', not 'confirmed' -- it cannot be checked in.`), { statusCode: 400 });
      }

      // Re-verify the bed is still actually held for this admission and
      // hasn't been released or reassigned since confirmation.
      const { rows: bedRows } = await client.query("SELECT * FROM beds WHERE id = $1 FOR UPDATE", [admission.bed_id]);
      const bed = bedRows[0];
      if (!bed || bed.status !== "reserved") {
        throw Object.assign(new Error("The reserved bed is no longer held -- select a bed again before checking in."), { statusCode: 409 });
      }

      const { rows: roomRows } = await client.query("SELECT * FROM rooms WHERE id = $1", [bed.room_id]);
      const room = roomRows[0];

      let userId = null;
      if (username) {
        const passwordHash = bcrypt.hashSync(password, 10);
        const { rows: userRows } = await client.query(
          "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, 'resident') RETURNING id",
          [admission.full_name, username, passwordHash]
        );
        userId = userRows[0].id;
      }

      const { rows: residentRows } = await client.query(
        `INSERT INTO residents (user_id, branch_id, room_id, bed_id, full_name, cnic, phone, joining_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active') RETURNING id`,
        [userId, admission.branch_id, room.id, bed.id, admission.full_name, admission.cnic, admission.phone, checkInDate]
      );
      const residentId = residentRows[0].id;

      await client.query("UPDATE beds SET status = 'occupied' WHERE id = $1", [bed.id]);

      await client.query(
        `INSERT INTO resident_assignments (resident_id, branch_id, room_id, bed_id, start_date, rent_at_assignment, reason)
         VALUES ($1, $2, $3, $4, $5, $6, 'check_in')`,
        [residentId, admission.branch_id, room.id, bed.id, checkInDate, room.monthly_rent]
      );

      const checkInDateObj = new Date(checkInDate);
      const charges = [
        ["registration_fee", admission.registration_fee],
        ["security_fee", admission.security_fee],
        ["monthly_rent", room.monthly_rent],
      ];
      for (const [type, amount] of charges) {
        if (amount == null) continue;
        if (type === "monthly_rent") {
          await client.query(
            `INSERT INTO charges (resident_id, branch_id, type, amount, due_date, period_month, status)
             VALUES ($1, $2, 'monthly_rent', $3, $4, $5, 'due')`,
            [residentId, admission.branch_id, amount, checkInDate, monthKeyOf(checkInDateObj) + "-01"]
          );
        } else {
          await client.query(
            `INSERT INTO charges (resident_id, branch_id, type, amount, due_date, status, description)
             VALUES ($1, $2, $3, $4, $5, 'due', $6)`,
            [residentId, admission.branch_id, type, amount, checkInDate, `${type.replace("_", " ")} at check-in`]
          );
        }
      }

      await client.query(
        "UPDATE admissions SET status = 'converted', resident_id = $1 WHERE id = $2",
        [residentId, admissionId]
      );

      return { residentId };
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return sendDbError(res, err);
  }

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "check_in", entityType: "resident", entityId: result.residentId,
    metadata: { admissionId, checkInDate }, ipAddress: req.ip,
  });

  const { rows } = await query(
    `SELECT residents.*, branches.name AS branch_name, rooms.room_number, rooms.room_type,
            rooms.bathroom_type, rooms.monthly_rent, beds.bed_number
     FROM residents
     JOIN branches ON branches.id = residents.branch_id
     JOIN rooms ON rooms.id = residents.room_id
     JOIN beds ON beds.id = residents.bed_id
     WHERE residents.id = $1`,
    [result.residentId]
  );
  res.status(201).json(rows[0]);
}));

/**
 * Pre-checkout numbers (spec section 14: "Before checkout show: Unpaid
 * rent, Other charges, Security balance, Possible refund"). Computed at
 * the resident level, since charges and payments aren't reconciled
 * one-to-one in this schema (see db/POSTGRES_SCHEMA.md's note on
 * payments) -- "possible refund" is a suggested figure for the admin to
 * review, not an automatic transaction. Actually recording a final
 * payment or refund is Payments/Receipts (Phase 10) -- this is read-only.
 *
 * NOTE: this works correctly today only because it requires the same
 * role (admin/super_admin) as routes-pg/residents.js's blanket
 * router.use(requireRole(...)) gate. Express applies that gate to EVERY
 * request under the /api/residents/* mount, including this one defined
 * in a different file -- it's a no-op here since the roles match, but a
 * resident-scoped route at a "/residents/..." path (like Phase 9's
 * /me/dues) would be silently blocked the same way /me/dues briefly was.
 * Any future resident-facing route under this path prefix belongs in
 * residents.js itself, before its admin/super_admin gate -- not here.
 */
router.get("/residents/:id/checkout-preview", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resident = await query("SELECT * FROM residents WHERE id = $1", [id]);
  if (!resident.rows[0]) return res.status(404).json({ error: "Resident not found." });

  // Reuses the same refund-aware calculation as the resident dues view
  // (Phase 9 / lib/dues.js) rather than a second, separately-maintained
  // copy -- this file originally had its own duplicate before Phase 10
  // fixed a real gap: refunds were about to be summed into "amount paid",
  // which would have wrongly shrunk the outstanding balance the moment
  // Phase 10 introduced actual refund payments.
  const dues = await computeDues(id);
  const securityFeeOnFile = dues.securityFee;

  res.json({
    residentId: id,
    rentCharged: dues.monthlyRent,
    otherChargesCharged: dues.otherCharges,
    registrationFeeCharged: dues.registrationFee,
    securityFeeOnFile,
    totalCharges: dues.totalCharges,
    totalPaid: dues.amountPaid,
    totalRefunded: dues.totalRefunded,
    outstandingBalance: dues.remainingBalance,
    possibleRefund: Math.max(0, securityFeeOnFile - dues.remainingBalance),
    amountStillOwedBeyondSecurity: Math.max(0, dues.remainingBalance - securityFeeOnFile),
    note: "possibleRefund and amountStillOwedBeyondSecurity are suggested figures for review, not an automatic transaction -- record the actual final payment or refund via POST /api/payments.",
  });
}));

/**
 * Check-out (spec section 14). Closes the current stay: resident becomes
 * Checked Out, bed becomes Available, the open resident_assignments row
 * is closed (never deleted or rewritten), and the resident's historical
 * financial records (charges, payments) are left completely untouched.
 */
router.post("/check-out", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { residentId, checkoutDate } = req.body || {};
  if (!residentId) return res.status(400).json({ error: "residentId is required." });
  const date = checkoutDate || new Date().toISOString().slice(0, 10);

  try {
    await withTransaction(async (client) => {
      const { rows: residentRows } = await client.query("SELECT * FROM residents WHERE id = $1 FOR UPDATE", [residentId]);
      const resident = residentRows[0];
      if (!resident) throw Object.assign(new Error("Resident not found."), { statusCode: 404 });
      if (resident.status !== "active") {
        throw Object.assign(new Error(`This resident is '${resident.status}', not 'active' -- there is no current stay to check out of.`), { statusCode: 400 });
      }

      const { rows: assignmentRows } = await client.query(
        "SELECT * FROM resident_assignments WHERE resident_id = $1 AND end_date IS NULL FOR UPDATE",
        [residentId]
      );
      const assignment = assignmentRows[0];
      if (!assignment) throw Object.assign(new Error("No open stay-history record was found for this resident."), { statusCode: 409 });
      if (new Date(date) < new Date(assignment.start_date)) {
        throw Object.assign(new Error("Checkout date cannot be before the stay's start date."), { statusCode: 400 });
      }

      await client.query("UPDATE resident_assignments SET end_date = $1 WHERE id = $2", [date, assignment.id]);
      await client.query("UPDATE beds SET status = 'available' WHERE id = $1", [resident.bed_id]);
      await client.query(
        "UPDATE residents SET status = 'checked_out', room_id = NULL, bed_id = NULL WHERE id = $1",
        [residentId]
      );
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return sendDbError(res, err);
  }

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "check_out", entityType: "resident", entityId: Number(residentId),
    metadata: { checkoutDate: date }, ipAddress: req.ip,
  });

  const { rows } = await query("SELECT * FROM residents WHERE id = $1", [residentId]);
  res.json(rows[0]);
}));

module.exports = router;
