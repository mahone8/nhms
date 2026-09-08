const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { computeBranchEarningsInRange } = require("../lib/earnings");
const { computeMessReport } = require("../lib/messReport");
const { sendReport } = require("../lib/csv");

const router = express.Router();
router.use(requireRole("admin", "super_admin"));

// PDF/Excel export are deliberately not built in this phase -- there's no
// frontend yet anywhere in the Postgres app to trigger a download from,
// and both would add a real dependency (a PDF library, exceljs) for a
// feature nothing can use yet. CSV costs nothing extra (see lib/csv.js)
// and is genuinely useful as-is, including piped straight from curl.

// --- Resident reports (spec section 25) -------------------------------------
// One flexible endpoint covers "current/active/checked-out/suspended",
// "new admissions" (via date range on joining_date), and
// "branch-wise/university-wise/department-wise" (via groupBy) rather than
// eight separate routes for what is really one filtered query.
router.get("/residents", asyncHandler(async (req, res) => {
  const { status, branch, university, department, from, to, groupBy } = req.query;
  const conditions = [];
  const params = [];

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`residents.status = $${params.length}`);
  }
  if (branch && branch !== "All") {
    params.push(branch);
    conditions.push(`branches.name = $${params.length}`);
  }
  if (university) {
    params.push(university);
    conditions.push(`residents.university = $${params.length}`);
  }
  if (department) {
    params.push(department);
    conditions.push(`residents.department = $${params.length}`);
  }
  if (from) { params.push(from); conditions.push(`residents.joining_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`residents.joining_date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  if (["branch", "university", "department"].includes(groupBy)) {
    const column = groupBy === "branch" ? "branches.name" : `residents.${groupBy}`;
    const { rows } = await query(
      `SELECT ${column} AS group_value, COUNT(*) AS resident_count
       FROM residents JOIN branches ON branches.id = residents.branch_id
       ${where} GROUP BY ${column} ORDER BY resident_count DESC`,
      params
    );
    return sendReport(req, res, rows.map((r) => ({ group: r.group_value, residentCount: Number(r.resident_count) })), `residents-by-${groupBy}`);
  }

  const { rows } = await query(
    `SELECT residents.id, residents.full_name, residents.status, residents.joining_date,
            residents.university, residents.department, branches.name AS branch_name
     FROM residents JOIN branches ON branches.id = residents.branch_id
     ${where} ORDER BY residents.full_name LIMIT 1000`,
    params
  );
  sendReport(req, res, rows, "residents");
}));

// --- Room reports ------------------------------------------------------------
// Available/Occupied/Reserved are bed statuses, not a single status a
// whole room can have (a room can hold a mix) -- this reports at the bed
// level, grouped by the room attributes spec section 25 lists.
router.get("/rooms", asyncHandler(async (req, res) => {
  const { branch, roomType, bathroomType, status, groupBy } = req.query;
  const conditions = [];
  const params = [];

  if (branch && branch !== "All") { params.push(branch); conditions.push(`branches.name = $${params.length}`); }
  if (roomType) { params.push(roomType); conditions.push(`rooms.room_type = $${params.length}`); }
  if (bathroomType) { params.push(bathroomType); conditions.push(`rooms.bathroom_type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`beds.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  if (["roomType", "bathroomType", "status"].includes(groupBy)) {
    const column = { roomType: "rooms.room_type", bathroomType: "rooms.bathroom_type", status: "beds.status" }[groupBy];
    const { rows } = await query(
      `SELECT ${column} AS group_value, COUNT(*) AS bed_count
       FROM beds JOIN rooms ON rooms.id = beds.room_id JOIN branches ON branches.id = beds.branch_id
       ${where} GROUP BY ${column} ORDER BY bed_count DESC`,
      params
    );
    return sendReport(req, res, rows.map((r) => ({ group: r.group_value, bedCount: Number(r.bed_count) })), `rooms-by-${groupBy}`);
  }

  const { rows } = await query(
    `SELECT beds.id AS bed_id, beds.bed_number, beds.status, rooms.room_number, rooms.room_type,
            rooms.bathroom_type, branches.name AS branch_name
     FROM beds JOIN rooms ON rooms.id = beds.room_id JOIN branches ON branches.id = beds.branch_id
     ${where} ORDER BY branches.name, rooms.room_number, beds.bed_number LIMIT 1000`,
    params
  );
  sendReport(req, res, rows, "rooms");
}));

// --- Occupancy reports --------------------------------------------------------
// A current snapshot per branch -- there's no historical occupancy
// time-series table (that would need periodic snapshots this system
// doesn't take), so "date range" isn't meaningful here the way it is for
// financial reports; this deliberately reports live state only.
router.get("/occupancy", asyncHandler(async (req, res) => {
  const { branch } = req.query;
  const conditions = [];
  const params = [];
  if (branch && branch !== "All") { params.push(branch); conditions.push(`branches.name = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await query(
    `SELECT branches.id AS branch_id, branches.name AS branch_name,
            COUNT(beds.id) AS total_beds,
            COUNT(beds.id) FILTER (WHERE beds.status = 'available') AS available,
            COUNT(beds.id) FILTER (WHERE beds.status = 'reserved') AS reserved,
            COUNT(beds.id) FILTER (WHERE beds.status = 'occupied') AS occupied
     FROM branches LEFT JOIN beds ON beds.branch_id = branches.id
     ${where} GROUP BY branches.id, branches.name ORDER BY branches.name`,
    params
  );
  const shaped = rows.map((r) => {
    const total = Number(r.total_beds);
    const available = Number(r.available);
    const reserved = Number(r.reserved);
    const occupied = Number(r.occupied);
    return {
      branchId: r.branch_id, branchName: r.branch_name, totalBeds: total,
      availableCapacity: available + reserved, available, reserved, occupied,
      occupancyPercent: total > 0 ? Math.round((occupied / total) * 10000) / 100 : 0,
    };
  });
  sendReport(req, res, shaped, "occupancy");
}));

// --- Financial reports ---------------------------------------------------------
// Every field spec section 25 lists, for a date range, either one branch
// or all branches, plus a daily/monthly collection breakdown.
router.get("/financial", asyncHandler(async (req, res) => {
  const from = req.query.from || "1970-01-01";
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const { branch, groupBy } = req.query;

  if (["day", "month"].includes(groupBy)) {
    const conditions = ["payment_date BETWEEN $1 AND $2"];
    const params = [from, to];
    if (branch && branch !== "All") {
      params.push(branch);
      conditions.push(`branches.name = $${params.length}`);
    }
    const trunc = groupBy === "day" ? "payment_date" : "date_trunc('month', payment_date)::date";
    const { rows } = await query(
      `SELECT ${trunc} AS period, COALESCE(SUM(amount) FILTER (WHERE payment_type != 'refund'), 0) AS collected
       FROM payments JOIN branches ON branches.id = payments.branch_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY period ORDER BY period`,
      params
    );
    return sendReport(req, res, rows.map((r) => ({ period: r.period, collected: Number(r.collected) })), `collection-by-${groupBy}`);
  }

  const { rows: branches } = await query(
    branch && branch !== "All" ? "SELECT id, name FROM branches WHERE name = $1" : "SELECT id, name FROM branches ORDER BY id",
    branch && branch !== "All" ? [branch] : []
  );
  const perBranch = await Promise.all(
    branches.map(async (b) => ({ branchId: b.id, branchName: b.name, ...(await computeBranchEarningsInRange(b.id, from, to)) }))
  );
  const totals = perBranch.reduce((acc, b) => ({
    rentCollected: acc.rentCollected + b.rentCollected,
    registrationFeesCollected: acc.registrationFeesCollected + b.registrationFeesCollected,
    securityFeesCollected: acc.securityFeesCollected + b.securityFeesCollected,
    otherRevenue: acc.otherRevenue + b.otherRevenue,
    totalRevenue: acc.totalRevenue + b.totalRevenue,
    expenses: acc.expenses + b.expenses,
    netIncome: acc.netIncome + b.netIncome,
  }), { rentCollected: 0, registrationFeesCollected: 0, securityFeesCollected: 0, otherRevenue: 0, totalRevenue: 0, expenses: 0, netIncome: 0 });

  if (req.query.format === "csv") return sendReport(req, res, perBranch, "financial-by-branch");
  res.json({ from, to, ...totals, branchEarnings: perBranch });
}));

// --- Mess reports --------------------------------------------------------------
router.get("/mess", asyncHandler(async (req, res) => {
  const from = req.query.from || "1970-01-01";
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const report = await computeMessReport(from, to);
  if (req.query.format === "csv") return sendReport(req, res, report.perMember, "mess-per-member");
  res.json(report);
}));

module.exports = router;
