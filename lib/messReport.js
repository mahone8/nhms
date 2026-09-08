const { query } = require("../db/pool");

/**
 * Extracted from Phase 12's inline route handler so this exact
 * calculation is used by both /api/mess/report (Phase 12) and
 * /api/reports/mess (Phase 16) -- one implementation, not two that could
 * drift apart.
 */
async function computeMessReport(from, to) {
  const { rows: memberCountRows } = await query(
    "SELECT COUNT(*) FILTER (WHERE status = 'active') AS active, COUNT(*) AS total FROM mess_members"
  );

  const { rows: expenseRows } = await query(
    "SELECT category, COALESCE(SUM(amount), 0) AS total FROM mess_expenses WHERE date BETWEEN $1 AND $2 GROUP BY category",
    [from, to]
  );
  const totalExpenses = expenseRows.reduce((sum, r) => sum + Number(r.total), 0);

  const { rows: mealCountRows } = await query(
    "SELECT COUNT(*) AS total FROM meal_records WHERE meal_date BETWEEN $1 AND $2",
    [from, to]
  );
  const totalMeals = Number(mealCountRows[0].total);
  const costPerMeal = totalMeals > 0 ? totalExpenses / totalMeals : 0;

  const { rows: perMemberRows } = await query(
    `SELECT residents.id AS resident_id, residents.full_name, COUNT(meal_records.id) AS meals_eaten
     FROM meal_records
     JOIN mess_members ON mess_members.id = meal_records.mess_member_id
     JOIN residents ON residents.id = mess_members.resident_id
     WHERE meal_date BETWEEN $1 AND $2
     GROUP BY residents.id, residents.full_name
     ORDER BY residents.full_name`,
    [from, to]
  );

  return {
    from, to,
    activeMembers: Number(memberCountRows[0].active),
    totalMembers: Number(memberCountRows[0].total),
    totalExpenses,
    expensesByCategory: Object.fromEntries(expenseRows.map((r) => [r.category, Number(r.total)])),
    totalMeals,
    costPerMeal: Math.round(costPerMeal * 100) / 100,
    perMember: perMemberRows.map((r) => ({
      residentId: r.resident_id,
      fullName: r.full_name,
      mealsEaten: Number(r.meals_eaten),
      estimatedShare: Math.round(Number(r.meals_eaten) * costPerMeal * 100) / 100,
    })),
  };
}

module.exports = { computeMessReport };
