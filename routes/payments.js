const express = require("express");
const db = require("../db/database");
const { requireAdmin, requireResident } = require("../middleware/auth");

const router = express.Router();

function shapePayment(p, residentName, branchName) {
  return {
    id: p.id,
    residentId: p.resident_id,
    residentName,
    branch: branchName,
    monthKey: p.month_key,
    monthLabel: p.month_label,
    amount: p.amount,
    status: p.status,
    paidDate: p.paid_date,
  };
}

// Admin: list all payments, optionally filtered
router.get("/", requireAdmin, (req, res) => {
  const { branch, status } = req.query;
  let rows = db.prepare(
    `SELECT payments.*, residents.name AS resident_name, branches.name AS branch_name
     FROM payments
     JOIN residents ON payments.resident_id = residents.id
     JOIN branches ON residents.branch_id = branches.id
     ORDER BY payments.month_key DESC, residents.name`
  ).all();

  if (branch && branch !== "All") rows = rows.filter((p) => p.branch_name === branch);
  if (status && status !== "All") rows = rows.filter((p) => p.status === status);

  res.json(rows.map((p) => shapePayment(p, p.resident_name, p.branch_name)));
});

// Resident: view own payment history
router.get("/me", requireResident, (req, res) => {
  const residentId = req.session.user.residentId;
  const rows = db.prepare(
    `SELECT payments.*, residents.name AS resident_name, branches.name AS branch_name
     FROM payments
     JOIN residents ON payments.resident_id = residents.id
     JOIN branches ON residents.branch_id = branches.id
     WHERE payments.resident_id = ?
     ORDER BY payments.month_key DESC`
  ).all(residentId);
  res.json(rows.map((p) => shapePayment(p, p.resident_name, p.branch_name)));
});

// Admin: mark a payment as paid
router.post("/:id/pay", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
  if (!payment) return res.status(404).json({ error: "Payment record not found." });
  const paidDate = new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE payments SET status = 'paid', paid_date = ? WHERE id = ?").run(paidDate, id);
  res.json({ ok: true, paidDate });
});

// Admin: record a new payment entry for a resident
router.post("/", requireAdmin, (req, res) => {
  const { residentId, monthLabel, amount } = req.body || {};
  if (!residentId || !monthLabel || !String(monthLabel).trim()) {
    return res.status(400).json({ error: "residentId and monthLabel are required." });
  }
  const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(residentId);
  if (!resident) return res.status(404).json({ error: "Resident not found." });

  const monthKey = String(monthLabel).trim().toLowerCase().replace(/\s+/g, "-");
  const amt = Number(amount) || resident.monthly_fee;

  const id = Number(
    db.prepare(
      "INSERT INTO payments (resident_id, month_key, month_label, amount, status, paid_date) VALUES (?, ?, ?, ?, 'pending', NULL)"
    ).run(residentId, monthKey, String(monthLabel).trim(), amt).lastInsertRowid
  );
  res.status(201).json({ id });
});

module.exports = router;
