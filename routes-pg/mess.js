const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");
const { computeMessReport } = require("../lib/messReport");

const router = express.Router();

// Mounted at its own specific prefix (/api/mess) rather than nested under
// /api/residents or sharing the bare /api root -- see PAYMENTS_RECEIPTS.md
// and RENT_CHARGES.md for the two router-interception bugs that pattern
// caused in earlier phases. A dedicated prefix sidesteps the whole class
// of bug rather than needing to remember a workaround.
//
// IMPORTANT (spec section 21): this is ONE common mess shared across all
// five branches -- none of these tables have a branch_id, and nothing
// here ever writes to `charges` or `payments`. Mess finances are a
// completely separate ledger from resident hostel dues (see migration
// 012 and lib/dues.js's comment on the same point).

const MEAL_TYPES = ["breakfast", "lunch", "dinner"];
const EXPENSE_CATEGORIES = ["groceries", "utilities", "staff", "equipment", "other"];

// --- Resident's own mess info -----------------------------------------------
router.get("/members/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT mess_members.* FROM mess_members
     JOIN residents ON residents.id = mess_members.resident_id
     WHERE residents.user_id = $1`,
    [req.currentUser.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not currently a mess member." });
  res.json(rows[0]);
}));

router.get("/meal-records/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows: memberRows } = await query(
    `SELECT mess_members.id FROM mess_members
     JOIN residents ON residents.id = mess_members.resident_id
     WHERE residents.user_id = $1`,
    [req.currentUser.id]
  );
  if (!memberRows[0]) return res.status(404).json({ error: "Not currently a mess member." });

  const { rows } = await query(
    "SELECT meal_date, meal_type FROM meal_records WHERE mess_member_id = $1 ORDER BY meal_date DESC LIMIT 200",
    [memberRows[0].id]
  );
  res.json(rows);
}));

// Menus are viewable by anyone signed in (residents included) -- same
// spirit as the existing shared menu-image feature, just structured.
router.get("/menus", asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`menu_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`menu_date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM menus ${where} ORDER BY menu_date, meal_type LIMIT 200`, params);
  res.json(rows);
}));

// --- Admin / Super Admin: manage everything else ----------------------------
router.use(requireRole("admin", "super_admin"));

router.get("/members", asyncHandler(async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];
  if (status && status !== "All") { params.push(status); conditions.push(`mess_members.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT mess_members.*, residents.full_name, branches.name AS branch_name
     FROM mess_members
     JOIN residents ON residents.id = mess_members.resident_id
     JOIN branches ON branches.id = residents.branch_id
     ${where} ORDER BY residents.full_name`,
    params
  );
  res.json(rows);
}));

router.post("/members", asyncHandler(async (req, res) => {
  const { residentId } = req.body || {};
  if (!residentId) return res.status(400).json({ error: "residentId is required." });

  const resident = await query("SELECT id FROM residents WHERE id = $1", [residentId]);
  if (!resident.rows[0]) return res.status(404).json({ error: "Resident not found." });

  try {
    const { rows } = await query(
      "INSERT INTO mess_members (resident_id) VALUES ($1) RETURNING *",
      [residentId]
    );
    await logAction({
      userId: req.currentUser.id, role: req.currentUser.role,
      action: "add_mess_member", entityType: "mess_member", entityId: rows[0].id,
      newValues: rows[0], ipAddress: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.patch("/members/:id/status", asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status must be active or inactive." });
  }
  const existing = await query("SELECT * FROM mess_members WHERE id = $1", [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Mess member not found." });

  const { rows } = await query("UPDATE mess_members SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "change_mess_member_status", entityType: "mess_member", entityId: Number(req.params.id),
    oldValues: { status: existing.rows[0].status }, newValues: { status }, ipAddress: req.ip,
  });
  res.json(rows[0]);
}));

router.post("/menus", asyncHandler(async (req, res) => {
  const { menuDate, mealType, items } = req.body || {};
  if (!menuDate || !MEAL_TYPES.includes(mealType) || !items || !items.trim()) {
    return res.status(400).json({ error: `menuDate, items, and mealType (one of ${MEAL_TYPES.join(", ")}) are required.` });
  }
  try {
    const { rows } = await query(
      `INSERT INTO menus (menu_date, meal_type, items, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (menu_date, meal_type) DO UPDATE SET items = EXCLUDED.items
       RETURNING *`,
      [menuDate, mealType, items.trim(), req.currentUser.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    sendDbError(res, err);
  }
}));

router.post("/meal-records", asyncHandler(async (req, res) => {
  const { messMemberId, mealDate, mealType } = req.body || {};
  if (!messMemberId || !mealDate || !MEAL_TYPES.includes(mealType)) {
    return res.status(400).json({ error: `messMemberId, mealDate, and mealType (one of ${MEAL_TYPES.join(", ")}) are required.` });
  }
  const member = await query("SELECT * FROM mess_members WHERE id = $1", [messMemberId]);
  if (!member.rows[0]) return res.status(404).json({ error: "Mess member not found." });
  if (member.rows[0].status !== "active") {
    return res.status(409).json({ error: "This mess member is not active." });
  }

  try {
    const { rows } = await query(
      "INSERT INTO meal_records (mess_member_id, meal_date, meal_type) VALUES ($1, $2, $3) RETURNING *",
      [messMemberId, mealDate, mealType]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Attendance for this member, date, and meal is already recorded." });
    }
    sendDbError(res, err);
  }
}));

router.get("/meal-records", asyncHandler(async (req, res) => {
  const { messMemberId, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (messMemberId) { params.push(messMemberId); conditions.push(`meal_records.mess_member_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`meal_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`meal_date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT meal_records.*, residents.full_name
     FROM meal_records
     JOIN mess_members ON mess_members.id = meal_records.mess_member_id
     JOIN residents ON residents.id = mess_members.resident_id
     ${where} ORDER BY meal_date DESC LIMIT 1000`,
    params
  );
  res.json(rows);
}));

router.post("/expenses", asyncHandler(async (req, res) => {
  const { category, amount, date, description } = req.body || {};
  if (!EXPENSE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${EXPENSE_CATEGORIES.join(", ")}` });
  }
  if (amount == null || Number(amount) <= 0) return res.status(400).json({ error: "amount must be a positive number." });

  const { rows } = await query(
    "INSERT INTO mess_expenses (category, amount, date, description, recorded_by) VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING *",
    [category, Number(amount), date || null, description || null, req.currentUser.id]
  );
  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "add_mess_expense", entityType: "mess_expense", entityId: rows[0].id,
    newValues: rows[0], ipAddress: req.ip,
  });
  res.status(201).json(rows[0]);
}));

router.get("/expenses", asyncHandler(async (req, res) => {
  const { category, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (category && category !== "All") { params.push(category); conditions.push(`category = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM mess_expenses ${where} ORDER BY date DESC LIMIT 500`, params);
  res.json(rows);
}));

// Reports / Statistics (spec section 21): total mess spend, total meals
// served, cost per meal, and a per-member breakdown so cost can be
// apportioned fairly -- all computed from real recorded data, never from
// resident charges/payments (which this ledger never touches).
router.get("/report", asyncHandler(async (req, res) => {
  const from = req.query.from || "1970-01-01";
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  res.json(await computeMessReport(from, to));
}));

module.exports = router;
