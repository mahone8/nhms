const express = require("express");
const db = require("../db/database");
const { requireAdmin, requireResident } = require("../middleware/auth");

const router = express.Router();

function shapeResident(r, branchName) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    cnic: r.cnic,
    branch: branchName,
    branchId: r.branch_id,
    bedNumber: db.prepare("SELECT bed_number FROM beds WHERE id = ?").get(r.bed_id)?.bed_number,
    monthlyFee: r.monthly_fee,
    joinDate: r.join_date,
  };
}

// Admin: list/search residents across branches
router.get("/", requireAdmin, (req, res) => {
  const { branch, q } = req.query;
  let rows = db.prepare(
    `SELECT residents.*, branches.name AS branch_name
     FROM residents JOIN branches ON residents.branch_id = branches.id
     ORDER BY branches.name, residents.name`
  ).all();

  if (branch && branch !== "All") rows = rows.filter((r) => r.branch_name === branch);
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(String(q).toLowerCase()));

  res.json(rows.map((r) => shapeResident(r, r.branch_name)));
});

// Resident: view own record
router.get("/me", requireResident, (req, res) => {
  const residentId = req.session.user.residentId;
  const r = db.prepare(
    `SELECT residents.*, branches.name AS branch_name
     FROM residents JOIN branches ON residents.branch_id = branches.id
     WHERE residents.id = ?`
  ).get(residentId);
  if (!r) return res.status(404).json({ error: "Resident record not found." });
  res.json(shapeResident(r, r.branch_name));
});

module.exports = router;
