/**
 * Generates each active resident's monthly_rent charge for a given month.
 * Idempotent: relies on the same database-level guarantee established in
 * Phase 1 (migration 009's partial unique index,
 * `UNIQUE(resident_id, period_month) WHERE type = 'monthly_rent'`) --
 * running this twice for the same month is safely a no-op the second
 * time, not a duplicate charge. That guarantee is what makes it safe to
 * trigger this from two independent places (a CWP cron script and a
 * Vercel Cron HTTP endpoint) without any coordination between them.
 *
 * The charged amount comes from the resident's CURRENT open
 * resident_assignments row (rent_at_assignment) -- the rate they were
 * actually given at their last check-in or transfer -- not from the
 * room's current listing price. A room's listed rent can change for
 * future residents without silently changing what an existing resident
 * already agreed to pay.
 */
const { query } = require("../db/pool");

function pad(n) { return String(n).padStart(2, "0"); }

async function generateMonthlyRentCharges(targetDate = new Date()) {
  const periodMonth = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-01`;
  const monthLabel = targetDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  const { rows: residents } = await query(
    `SELECT residents.id AS resident_id, residents.branch_id, resident_assignments.rent_at_assignment
     FROM residents
     JOIN resident_assignments ON resident_assignments.resident_id = residents.id AND resident_assignments.end_date IS NULL
     WHERE residents.status = 'active'`
  );

  const created = [];
  let skipped = 0;

  for (const r of residents) {
    const { rows } = await query(
      `INSERT INTO charges (resident_id, branch_id, type, amount, due_date, period_month, status)
       VALUES ($1, $2, 'monthly_rent', $3, $4, $4, 'due')
       ON CONFLICT (resident_id, period_month) WHERE type = 'monthly_rent' DO NOTHING
       RETURNING id`,
      [r.resident_id, r.branch_id, r.rent_at_assignment, periodMonth]
    );
    if (rows[0]) {
      created.push({ residentId: r.resident_id, chargeId: rows[0].id, amount: r.rent_at_assignment });
    } else {
      skipped++; // already generated for this resident + month
    }
  }

  return {
    periodMonth,
    monthLabel,
    totalActiveResidents: residents.length,
    createdCount: created.length,
    skippedCount: skipped,
    created,
  };
}

module.exports = { generateMonthlyRentCharges };

// CLI entrypoint, for a CWP (or any) native cron job:
//   node jobs/generate-monthly-rent.js
if (require.main === module) {
  generateMonthlyRentCharges()
    .then((summary) => {
      console.log(
        `Monthly rent for ${summary.monthLabel}: ${summary.createdCount} charge(s) created, ` +
        `${summary.skippedCount} already existed (of ${summary.totalActiveResidents} active residents).`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Monthly rent generation failed:", err.message);
      process.exit(1);
    });
}
