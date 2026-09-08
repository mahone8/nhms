/**
 * Phase 1 pushed a lot of business rules down into the database itself
 * (capacity limits, duplicate-occupancy prevention, idempotency, etc.) --
 * see db/POSTGRES_SCHEMA.md. That's deliberate: one source of truth,
 * enforced no matter which route or bug tries to violate it. The tradeoff
 * is that violations surface as raw Postgres errors, which routes need to
 * translate into clean, friendly JSON instead of a generic 500.
 *
 * Usage: catch (err) { return sendDbError(res, err); }
 */
function sendDbError(res, err) {
  // Unique constraint violation (e.g. duplicate branch name, room number,
  // bed number, or username).
  if (err.code === "23505") {
    return res.status(409).json({ error: humanizeUniqueViolation(err) });
  }
  // Foreign key violation (e.g. referencing a branch/room/bed that
  // doesn't exist, or deleting something still referenced elsewhere).
  if (err.code === "23503") {
    return res.status(409).json({ error: "That would reference or remove something still in use elsewhere." });
  }
  // CHECK constraint violation (e.g. invalid enum value, negative rent).
  if (err.code === "23514") {
    return res.status(400).json({ error: "One of the values provided isn't valid." });
  }
  // RAISE EXCEPTION from one of our own trigger functions (capacity
  // limits, audit-log immutability, etc.) -- these messages are already
  // written to be human-readable, so pass them through directly.
  if (err.code === "P0001") {
    return res.status(409).json({ error: err.message });
  }
  // Anything else is unexpected -- log it and don't leak internals.
  console.error(err);
  return res.status(500).json({ error: "Something went wrong on our end." });
}

function humanizeUniqueViolation(err) {
  const constraint = err.constraint || "";
  if (constraint.includes("branches_name")) return "A branch with that name already exists.";
  if (constraint.includes("rooms_branch_id_room_number")) return "That room number is already used in this branch.";
  if (constraint.includes("beds_room_id_bed_number")) return "That bed number is already used in this room.";
  if (constraint.includes("users_username")) return "That username is already taken.";
  if (constraint.includes("mess_members_resident_id")) return "This resident is already a mess member.";
  if (constraint.includes("menus_menu_date_meal_type")) return "A menu for that date and meal already exists.";
  return "That already exists.";
}

module.exports = { sendDbError };
