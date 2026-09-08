const { query } = require("../db/pool");

// Every charge type this system knows about lives in the `charges` table
// alone. IMPORTANT (spec section 17): Common Mess charges (Phase 12) must
// NEVER be written here -- mess finances (mess_expenses, meal_records)
// are a completely separate set of tables (migration 012) with no
// relationship to this one.
const CHARGE_TYPES = ["monthly_rent", "security_fee", "registration_fee", "other", "discount", "adjustment"];

/**
 * The "Resident dues" view from spec section 17: Monthly Rent, Security
 * Fee, Registration Fee, Other Charges, Previous Outstanding, Total
 * Charges, Amount Paid, Remaining Balance, Due Date, Status.
 */
async function computeDues(residentId) {
  const { rows: chargeRows } = await query(
    "SELECT type, COALESCE(SUM(amount), 0) AS total, MIN(due_date) AS earliest_due FROM charges WHERE resident_id = $1 GROUP BY type",
    [residentId]
  );
  // Refunds are money going BACK to the resident -- they must not count
  // toward "amount paid" against charges (that would incorrectly shrink
  // the outstanding balance), so they're summed separately.
  const { rows: paidRows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE payment_type != 'refund'), 0) AS total_paid,
       COALESCE(SUM(amount) FILTER (WHERE payment_type = 'refund'), 0) AS total_refunded
     FROM payments WHERE resident_id = $1`,
    [residentId]
  );
  const { rows: latestRentRows } = await query(
    "SELECT amount FROM charges WHERE resident_id = $1 AND type = 'monthly_rent' ORDER BY period_month DESC LIMIT 1",
    [residentId]
  );

  const byType = Object.fromEntries(chargeRows.map((r) => [r.type, Number(r.total)]));
  const totalCharges = chargeRows.reduce((sum, r) => sum + Number(r.total), 0);
  const amountPaid = Number(paidRows[0].total_paid);
  const totalRefunded = Number(paidRows[0].total_refunded);
  const remainingBalance = totalCharges - amountPaid;

  // "Previous Outstanding" -- what was owed before the most recent
  // month's rent charge was added, i.e. everything except that one line.
  const latestRent = latestRentRows[0] ? Number(latestRentRows[0].amount) : 0;
  const previousOutstanding = remainingBalance - latestRent;

  const dueDates = chargeRows.map((r) => r.earliest_due).filter(Boolean);
  const nextDueDate = dueDates.length ? dueDates.sort()[0] : null;

  let status;
  if (remainingBalance <= 0) status = "paid";
  else if (amountPaid > 0) status = "partially_paid";
  else if (nextDueDate && new Date(nextDueDate) < new Date()) status = "overdue";
  else status = "due";

  return {
    monthlyRent: byType.monthly_rent || 0,
    securityFee: byType.security_fee || 0,
    registrationFee: byType.registration_fee || 0,
    otherCharges: (byType.other || 0) + (byType.discount || 0) + (byType.adjustment || 0),
    previousOutstanding,
    totalCharges,
    amountPaid,
    totalRefunded,
    remainingBalance,
    dueDate: nextDueDate,
    status,
  };
}

module.exports = { computeDues, CHARGE_TYPES };
