const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendDbError } = require("../lib/pgErrors");
const { logAction } = require("../lib/audit");
const { makeReceiptNumber, getReceiptData } = require("../lib/receipts");

const router = express.Router();

const PAYMENT_TYPES = ["monthly_rent", "security_fee", "registration_fee", "other", "refund"];
const PAYMENT_METHODS = ["cash", "bank_transfer", "online_payment", "other"];

// This file is intentionally its own top-level namespace (/api/payments/*)
// rather than nested under /api/residents/* -- see RENT_CHARGES.md for
// why that nesting trapped an earlier phase. Keeping payments entirely
// separate sidesteps the issue rather than working around it.

// --- Resident's own payments/receipts --------------------------------------
// Registered before the admin-only gate, and scoped by req.currentUser --
// never by a resident ID read from the request (spec section 20:
// "Residents can only access their own receipts").
router.get("/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows: residentRows } = await query("SELECT id FROM residents WHERE user_id = $1", [req.currentUser.id]);
  if (!residentRows[0]) return res.status(404).json({ error: "No resident profile is linked to this account yet." });

  const { rows } = await query(
    "SELECT * FROM payments WHERE resident_id = $1 ORDER BY payment_date DESC, id DESC",
    [residentRows[0].id]
  );
  res.json(rows);
}));

router.get("/me/:id", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows: residentRows } = await query("SELECT id FROM residents WHERE user_id = $1", [req.currentUser.id]);
  if (!residentRows[0]) return res.status(404).json({ error: "No resident profile is linked to this account yet." });

  const { rows: paymentRows } = await query("SELECT resident_id FROM payments WHERE id = $1", [req.params.id]);
  if (!paymentRows[0] || Number(paymentRows[0].resident_id) !== Number(residentRows[0].id)) {
    // 404, not 403 -- don't reveal whether a payment with this ID exists
    // at all if it isn't this resident's.
    return res.status(404).json({ error: "Receipt not found." });
  }

  res.json(await getReceiptData(req.params.id));
}));

// --- Admin / Super Admin: record and browse all payments -------------------
router.use(requireRole("admin", "super_admin"));

router.get("/", asyncHandler(async (req, res) => {
  const { branch, residentId, type, method } = req.query;
  const conditions = [];
  const params = [];
  if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  if (residentId) {
    params.push(residentId);
    conditions.push(`payments.resident_id = $${params.length}`);
  }
  if (type && type !== "All") {
    params.push(type);
    conditions.push(`payments.payment_type = $${params.length}`);
  }
  if (method && method !== "All") {
    params.push(method);
    conditions.push(`payments.payment_method = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT payments.*, residents.full_name AS resident_name, branches.name AS branch_name
     FROM payments
     JOIN residents ON residents.id = payments.resident_id
     JOIN branches ON branches.id = payments.branch_id
     ${where}
     ORDER BY payments.payment_date DESC, payments.id DESC LIMIT 500`,
    params
  );
  res.json(rows);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const receipt = await getReceiptData(req.params.id);
  if (!receipt) return res.status(404).json({ error: "Payment not found." });
  res.json(receipt);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { residentId, amount, paymentType, paymentMethod, paymentDate, notes } = req.body || {};

  if (!residentId) return res.status(400).json({ error: "residentId is required." });
  if (!PAYMENT_TYPES.includes(paymentType)) {
    return res.status(400).json({ error: `paymentType must be one of: ${PAYMENT_TYPES.join(", ")}` });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}` });
  }
  // The `amount > 0` CHECK constraint (migration 010) already guarantees
  // this at the database level -- validating here too just gives a
  // clean 400 instead of a database round trip for the common mistake.
  if (amount == null || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const { rows: residentRows } = await query("SELECT * FROM residents WHERE id = $1", [residentId]);
  const resident = residentRows[0];
  if (!resident) return res.status(404).json({ error: "Resident not found." });

  // Receipt numbers must be unique (spec section 19). Collisions should
  // be astronomically rare (date + branch + random suffix), but retry a
  // few times against the DB's own unique constraint rather than trust
  // that alone -- belt and suspenders.
  let payment;
  let lastErr;
  for (let attempt = 0; attempt < 5 && !payment; attempt++) {
    const receiptNumber = makeReceiptNumber(resident.branch_id);
    try {
      const { rows } = await query(
        `INSERT INTO payments (resident_id, branch_id, amount, payment_type, payment_method, payment_date, receipt_number, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, $9) RETURNING *`,
        [residentId, resident.branch_id, Number(amount), paymentType, paymentMethod, paymentDate || null, receiptNumber, notes || null, req.currentUser.id]
      );
      payment = rows[0];
    } catch (err) {
      if (err.code === "23505" && err.constraint?.includes("receipt_number")) {
        lastErr = err;
        continue; // regenerate and retry
      }
      return sendDbError(res, err);
    }
  }
  if (!payment) return sendDbError(res, lastErr);

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "record_payment", entityType: "payment", entityId: payment.id,
    newValues: payment, ipAddress: req.ip,
  });

  res.status(201).json(await getReceiptData(payment.id));
}));

module.exports = router;
