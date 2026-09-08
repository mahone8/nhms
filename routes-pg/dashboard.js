const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { computeBranchEarnings } = require("../lib/earnings");

const router = express.Router();
router.use(requireRole("admin", "super_admin"));

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

/**
 * Spec section 24's exact field list, company-wide plus a per-branch
 * card breakdown. Nothing new is computed here -- this composes
 * lib/earnings.js (Phase 14) and the same bed-status counting already
 * used by GET /api/branches (Phase 4), so the numbers on this dashboard
 * can never drift from what those other endpoints report.
 */
router.get("/", asyncHandler(async (req, res) => {
  const { rows: branches } = await query("SELECT id, name FROM branches ORDER BY id");

  const { rows: bedTotals } = await query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'occupied') AS occupied,
           COUNT(*) FILTER (WHERE status = 'available') AS available,
           COUNT(*) FILTER (WHERE status = 'reserved') AS reserved
    FROM beds
  `);
  const { rows: activeResidentRows } = await query("SELECT COUNT(*) AS total FROM residents WHERE status = 'active'");

  const perBranch = await Promise.all(branches.map(async (b) => {
    const { rows: bedRows } = await query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'occupied') AS occupied,
             COUNT(*) FILTER (WHERE status = 'available') AS available,
             COUNT(*) FILTER (WHERE status = 'reserved') AS reserved
      FROM beds WHERE branch_id = $1
    `, [b.id]);
    const bed = bedRows[0];
    const earnings = await computeBranchEarnings(b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      totalBeds: Number(bed.total),
      occupied: Number(bed.occupied),
      available: Number(bed.available),
      reserved: Number(bed.reserved),
      occupancyPercent: pct(Number(bed.occupied), Number(bed.total)),
      revenue: earnings.totalRevenue,
      expenses: earnings.expenses,
      earnings, // used below for the company-wide rollup, stripped before response
    };
  }));

  const companyTotals = perBranch.reduce((acc, b) => ({
    rentCollection: acc.rentCollection + b.earnings.rentCollected,
    registrationFees: acc.registrationFees + b.earnings.registrationFeesCollected,
    securityFees: acc.securityFees + b.earnings.securityFeesCollected,
    otherRevenue: acc.otherRevenue + b.earnings.otherRevenue,
    totalRevenue: acc.totalRevenue + b.earnings.totalRevenue,
    outstandingDues: acc.outstandingDues + b.earnings.outstandingDues,
    expenses: acc.expenses + b.earnings.expenses,
    netIncome: acc.netIncome + b.earnings.netIncome,
  }), {
    rentCollection: 0, registrationFees: 0, securityFees: 0, otherRevenue: 0,
    totalRevenue: 0, outstandingDues: 0, expenses: 0, netIncome: 0,
  });

  const totalBeds = Number(bedTotals[0].total);
  const occupiedBeds = Number(bedTotals[0].occupied);

  res.json({
    totalBranches: branches.length,
    totalBeds,
    occupiedBeds,
    availableBeds: Number(bedTotals[0].available),
    reservedBeds: Number(bedTotals[0].reserved),
    occupancyPercent: pct(occupiedBeds, totalBeds),
    activeResidents: Number(activeResidentRows[0].total),
    ...companyTotals,
    branchCards: perBranch.map(({ earnings, ...card }) => card), // internal `earnings` field never leaves this endpoint
  });
}));

module.exports = router;
