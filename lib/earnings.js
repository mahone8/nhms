const { query } = require("../db/pool");

/**
 * Spec section 23's exact formula:
 *   Total Revenue = Actual collected rent + registration + security + other revenue
 *   Net Income = Total Revenue - Branch Expenses
 *   "Revenue must be based on actual payments collected, not charges
 *   generated" -- the spec's own worked example: charges of 1,000,000
 *   with 850,000 actually collected means revenue is 850,000, not
 *   1,000,000. This function only ever sums `payments`, never `charges`,
 *   for the revenue figures.
 *
 * Refunds (payment_type = 'refund') are money paid back OUT to a
 * resident -- they reduce net revenue, they are not "other revenue".
 *
 * "Branch Expenses" in the Net Income formula means expenses recorded
 * against this specific branch_id -- Common/All Branches expenses
 * (branch_id IS NULL) are deliberately not divided across branches here,
 * since the spec doesn't define an allocation policy for them.
 */
async function computeBranchEarnings(branchId) {
  const { rows: paymentRows } = await query(
    `SELECT payment_type, COALESCE(SUM(amount), 0) AS total
     FROM payments WHERE branch_id = $1 GROUP BY payment_type`,
    [branchId]
  );
  const byType = Object.fromEntries(paymentRows.map((r) => [r.payment_type, Number(r.total)]));

  const rentCollected = byType.monthly_rent || 0;
  const registrationFeesCollected = byType.registration_fee || 0;
  const securityFeesCollected = byType.security_fee || 0;
  const otherRevenue = byType.other || 0;
  const refunded = byType.refund || 0;

  const totalRevenue = rentCollected + registrationFeesCollected + securityFeesCollected + otherRevenue - refunded;

  const { rows: expenseRows } = await query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE branch_id = $1",
    [branchId]
  );
  const expenses = Number(expenseRows[0].total);
  const netIncome = totalRevenue - expenses;

  const { rows: chargeRows } = await query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM charges WHERE branch_id = $1",
    [branchId]
  );
  const totalCharges = Number(chargeRows[0].total);
  // Outstanding uses gross collected (before subtracting refunds) against
  // gross charged -- a refund doesn't un-charge a resident, it's a
  // separate cash event, so it shouldn't appear to increase what they
  // still owe.
  const grossCollected = rentCollected + registrationFeesCollected + securityFeesCollected + otherRevenue;
  const outstandingDues = totalCharges - grossCollected;

  return {
    rentCollected,
    registrationFeesCollected,
    securityFeesCollected,
    otherRevenue,
    refunded,
    totalRevenue,
    expenses,
    netIncome,
    outstandingDues,
  };
}

/**
 * Same formula as computeBranchEarnings above, restricted to a date
 * range -- for Reports (Phase 16), which needs "daily collection,
 * monthly collection" style filtering. Kept as a separate function
 * rather than adding optional params to computeBranchEarnings, so
 * Phases 14/15 (already tested against the all-time version) can't be
 * accidentally affected by a change here.
 */
async function computeBranchEarningsInRange(branchId, from, to) {
  const { rows: paymentRows } = await query(
    `SELECT payment_type, COALESCE(SUM(amount), 0) AS total
     FROM payments WHERE branch_id = $1 AND payment_date BETWEEN $2 AND $3
     GROUP BY payment_type`,
    [branchId, from, to]
  );
  const byType = Object.fromEntries(paymentRows.map((r) => [r.payment_type, Number(r.total)]));

  const rentCollected = byType.monthly_rent || 0;
  const registrationFeesCollected = byType.registration_fee || 0;
  const securityFeesCollected = byType.security_fee || 0;
  const otherRevenue = byType.other || 0;
  const refunded = byType.refund || 0;
  const totalRevenue = rentCollected + registrationFeesCollected + securityFeesCollected + otherRevenue - refunded;

  const { rows: expenseRows } = await query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE branch_id = $1 AND date BETWEEN $2 AND $3",
    [branchId, from, to]
  );
  const expenses = Number(expenseRows[0].total);

  return {
    rentCollected, registrationFeesCollected, securityFeesCollected, otherRevenue, refunded,
    totalRevenue, expenses, netIncome: totalRevenue - expenses,
  };
}

module.exports = { computeBranchEarnings, computeBranchEarningsInRange };
