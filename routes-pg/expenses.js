const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { logAction } = require("../lib/audit");

const router = express.Router();
router.use(requireRole("admin", "super_admin"));

// Matches the exact category list from spec section 22 and the CHECK
// constraint already enforcing it at the database level (migration 011).
const EXPENSE_CATEGORIES = [
  "electricity", "gas", "water", "internet", "salaries",
  "food", "cleaning", "transportation", "rent", "miscellaneous", "other",
];

router.get("/", asyncHandler(async (req, res) => {
  const { branch, category, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (branch === "common") {
    conditions.push("expenses.branch_id IS NULL");
  } else if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  if (category && category !== "All") {
    params.push(category);
    conditions.push(`expenses.category = $${params.length}`);
  }
  if (from) { params.push(from); conditions.push(`expenses.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`expenses.date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT expenses.*, branches.name AS branch_name, users.name AS recorded_by_name
     FROM expenses
     LEFT JOIN branches ON branches.id = expenses.branch_id
     LEFT JOIN users ON users.id = expenses.recorded_by
     ${where}
     ORDER BY expenses.date DESC, expenses.id DESC LIMIT 500`,
    params
  );
  res.json(rows);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT expenses.*, branches.name AS branch_name, users.name AS recorded_by_name
     FROM expenses
     LEFT JOIN branches ON branches.id = expenses.branch_id
     LEFT JOIN users ON users.id = expenses.recorded_by
     WHERE expenses.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Expense not found." });
  res.json(rows[0]);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { branchId, category, amount, date, description } = req.body || {};

  if (!EXPENSE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${EXPENSE_CATEGORIES.join(", ")}` });
  }
  if (amount == null || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  // branchId omitted or null -> a Common/All Branches expense, per spec
  // section 22 ("Expenses can belong to: A specific branch, Common/All
  // Branches"). Validated explicitly rather than just trusting a null.
  let resolvedBranchId = null;
  if (branchId != null) {
    const branch = await query("SELECT id FROM branches WHERE id = $1", [branchId]);
    if (!branch.rows[0]) return res.status(400).json({ error: "That branch does not exist." });
    resolvedBranchId = branchId;
  }

  const { rows } = await query(
    `INSERT INTO expenses (branch_id, category, amount, date, description, recorded_by)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6) RETURNING *`,
    [resolvedBranchId, category, Number(amount), date || null, description || null, req.currentUser.id]
  );

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "add_expense", entityType: "expense", entityId: rows[0].id,
    newValues: rows[0], ipAddress: req.ip,
  });

  res.status(201).json(rows[0]);
}));

module.exports = router;
