const express = require("express");
const { query } = require("../db/pool");
const { requireAuth } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { computeDues } = require("../lib/dues");

const router = express.Router();

/**
 * Spec section 26: search by resident name, CNIC, phone, student ID,
 * room number, bed number, or receipt number, with filters for branch,
 * room type, bathroom type, room, bed, university, department, status,
 * and payment status.
 *
 * "Search must respect permissions. Resident users must only
 * search/view their own permitted information." -- rather than trying to
 * scrub a resident's query or results after the fact, the WHERE clause
 * itself is hard-constrained to their own resident_id when the caller is
 * a resident. No value in the query string can widen that constraint --
 * a resident searching another person's name, CNIC, or receipt number
 * gets zero results, not a permission error that would confirm the
 * record exists.
 */
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { q, branch, roomType, bathroomType, room, bed, university, department, status, paymentStatus } = req.query;

  let ownResidentId = null;
  if (req.currentUser.role === "resident") {
    const { rows } = await query("SELECT id FROM residents WHERE user_id = $1", [req.currentUser.id]);
    if (!rows[0]) return res.json({ residents: [], receipts: [] }); // no linked profile -- nothing to search
    ownResidentId = rows[0].id;
  }

  // --- Residents -------------------------------------------------------
  const conditions = [];
  const params = [];

  if (ownResidentId != null) {
    params.push(ownResidentId);
    conditions.push(`residents.id = $${params.length}`);
    // A resident's own-record scope narrows WHAT they can ever see, but
    // their typed query should still matter for WHETHER they see it --
    // otherwise any search (including someone else's name or a random
    // string) would return their own record regardless of relevance,
    // which is safe but wrong: it looks like a match when there wasn't
    // one. Applying the same text condition here, AND'd with the id
    // scope above, keeps both properties: never anyone else's data, and
    // an actual "no results" when their query doesn't match anything of
    // theirs.
    if (q) {
      params.push(`%${q}%`);
      const likeParam = params.length;
      params.push(q);
      const exactParam = params.length;
      conditions.push(`(
        residents.full_name ILIKE $${likeParam} OR residents.cnic ILIKE $${likeParam} OR
        residents.phone ILIKE $${likeParam} OR residents.student_id ILIKE $${likeParam} OR
        rooms.room_number ILIKE $${likeParam} OR beds.bed_number::text = $${exactParam}
      )`);
    }
  } else if (q) {
    // Every branch of this OR uses its own $N parameter -- no string
    // interpolation of user input into the SQL text anywhere here.
    params.push(`%${q}%`);
    const likeParam = params.length;
    params.push(q);
    const exactParam = params.length;
    conditions.push(`(
      residents.full_name ILIKE $${likeParam} OR residents.cnic ILIKE $${likeParam} OR
      residents.phone ILIKE $${likeParam} OR residents.student_id ILIKE $${likeParam} OR
      rooms.room_number ILIKE $${likeParam} OR beds.bed_number::text = $${exactParam}
    )`);
  }

  if (branch && branch !== "All") { params.push(branch); conditions.push(`branches.name = $${params.length}`); }
  if (roomType) { params.push(roomType); conditions.push(`rooms.room_type = $${params.length}`); }
  if (bathroomType) { params.push(bathroomType); conditions.push(`rooms.bathroom_type = $${params.length}`); }
  if (room) { params.push(room); conditions.push(`rooms.room_number = $${params.length}`); }
  if (bed) { params.push(bed); conditions.push(`beds.bed_number = $${params.length}`); }
  if (university) { params.push(university); conditions.push(`residents.university = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`residents.department = $${params.length}`); }
  if (status && status !== "All") { params.push(status); conditions.push(`residents.status = $${params.length}`); }

  let residents = [];
  if (conditions.length) {
    const { rows } = await query(
      `SELECT residents.id, residents.full_name, residents.cnic, residents.phone, residents.student_id,
              residents.status, residents.university, residents.department,
              branches.name AS branch_name, rooms.room_number, beds.bed_number
       FROM residents
       JOIN branches ON branches.id = residents.branch_id
       LEFT JOIN rooms ON rooms.id = residents.room_id
       LEFT JOIN beds ON beds.id = residents.bed_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 200`,
      params
    );
    residents = rows;
  }

  // Payment status is computed (Phase 9's dues logic), not a stored
  // column, so it's applied as a post-filter over the (already narrow,
  // capped-at-200) candidate set rather than in SQL.
  if (paymentStatus && paymentStatus !== "All") {
    const withDues = await Promise.all(residents.map(async (r) => ({ r, dues: await computeDues(r.id) })));
    residents = withDues.filter((x) => x.dues.status === paymentStatus).map((x) => ({ ...x.r, paymentStatus: x.dues.status }));
  }

  // --- Receipts (by receipt number) -------------------------------------
  let receipts = [];
  if (q) {
    const receiptParams = [`%${q}%`];
    let residentScope = "";
    if (ownResidentId != null) {
      receiptParams.push(ownResidentId);
      residentScope = ` AND payments.resident_id = $${receiptParams.length}`;
    }
    const { rows } = await query(
      `SELECT payments.id, payments.receipt_number, payments.amount, payments.payment_type,
              payments.payment_date, residents.full_name AS resident_name
       FROM payments JOIN residents ON residents.id = payments.resident_id
       WHERE payments.receipt_number ILIKE $1${residentScope}
       LIMIT 50`,
      receiptParams
    );
    receipts = rows;
  }

  res.json({ residents, receipts });
}));

module.exports = router;
