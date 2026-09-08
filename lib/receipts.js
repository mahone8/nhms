const { query } = require("../db/pool");
const { computeDues } = require("./dues");

function pad(n, len = 2) { return String(n).padStart(len, "0"); }

/** HMS-<branchId>-<YYYYMMDD>-<4 random alphanumeric chars>. */
function makeReceiptNumber(branchId) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `HMS-${branchId}-${dateStr}-${suffix}`;
}

/**
 * Everything spec section 20 requires a receipt to show: hostel name,
 * receipt number, resident name, CNIC, branch, room, bed, payment date,
 * type, amount, method, who received it, and remaining balance.
 *
 * Room/bed are resolved as of the payment date (not the resident's
 * current room/bed) by looking at resident_assignments -- a receipt is a
 * historical document, so if the resident transfers rooms afterward, an
 * old receipt should still show where they were when they actually paid.
 */
async function getReceiptData(paymentId) {
  const { rows } = await query(
    `SELECT payments.*, residents.full_name AS resident_name, residents.cnic,
            branches.name AS branch_name, users.name AS received_by_name
     FROM payments
     JOIN residents ON residents.id = payments.resident_id
     JOIN branches ON branches.id = payments.branch_id
     LEFT JOIN users ON users.id = payments.recorded_by
     WHERE payments.id = $1`,
    [paymentId]
  );
  const payment = rows[0];
  if (!payment) return null;

  const { rows: assignmentRows } = await query(
    `SELECT rooms.room_number, beds.bed_number
     FROM resident_assignments
     JOIN rooms ON rooms.id = resident_assignments.room_id
     JOIN beds ON beds.id = resident_assignments.bed_id
     WHERE resident_assignments.resident_id = $1
       AND resident_assignments.start_date <= $2
       AND (resident_assignments.end_date IS NULL OR resident_assignments.end_date >= $2)
     ORDER BY resident_assignments.start_date DESC LIMIT 1`,
    [payment.resident_id, payment.payment_date]
  );
  const placement = assignmentRows[0] || {};

  const dues = await computeDues(payment.resident_id);

  return {
    hostelName: "Hostel Management System",
    receiptNumber: payment.receipt_number,
    paymentId: payment.id,
    residentName: payment.resident_name,
    cnic: payment.cnic,
    branchName: payment.branch_name,
    roomNumber: placement.room_number || null,
    bedNumber: placement.bed_number || null,
    paymentDate: payment.payment_date,
    paymentType: payment.payment_type,
    amount: payment.amount,
    paymentMethod: payment.payment_method,
    notes: payment.notes,
    receivedBy: payment.received_by_name || null,
    remainingBalance: dues.remainingBalance,
    createdAt: payment.created_at,
  };
}

module.exports = { makeReceiptNumber, getReceiptData };
