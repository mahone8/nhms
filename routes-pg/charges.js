const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");

const router = express.Router();
router.use(requireRole("admin", "super_admin"));

// General charges browser -- filterable, for the Dashboard/Reports phases
// to build on later. Resident-specific dues/charge-creation routes live
// in routes-pg/residents.js instead (see the comment there explaining
// why -- nesting them under a separately-mounted "/residents/..." router
// here would silently collide with residents.js's own access-control
// middleware).
router.get("/", asyncHandler(async (req, res) => {
  const { branch, residentId, type, status } = req.query;
  const conditions = [];
  const params = [];
  if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  if (residentId) {
    params.push(residentId);
    conditions.push(`charges.resident_id = $${params.length}`);
  }
  if (type && type !== "All") {
    params.push(type);
    conditions.push(`charges.type = $${params.length}`);
  }
  if (status && status !== "All") {
    params.push(status);
    conditions.push(`charges.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT charges.*, residents.full_name AS resident_name, branches.name AS branch_name
     FROM charges
     JOIN residents ON residents.id = charges.resident_id
     JOIN branches ON branches.id = charges.branch_id
     ${where}
     ORDER BY charges.created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
}));

module.exports = router;
