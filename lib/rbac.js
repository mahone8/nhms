/**
 * This is what makes RBAC real rather than cosmetic (spec section 40:
 * "Frontend hiding is NOT security" / "verify authentication, verify user
 * is active, verify role" -- on EVERY protected request, not just at
 * login).
 *
 * lib/jwt.js proves the token wasn't forged (a valid signature means the
 * userId in it really was issued by us). It does NOT prove the account is
 * still active, or still the same role, at THIS moment -- an account
 * could be deactivated or have its role changed after a token was issued
 * but before it expires. So every protected request re-reads the user's
 * current row from the database and authorizes off that, never off the
 * token's claims alone.
 */
const { query } = require("../db/pool");

/**
 * Express middleware. Requires lib/jwt.js's attachUser to have already run
 * (so req.user holds the decoded, signature-verified token payload, or
 * null). Looks the user up fresh and attaches req.currentUser -- or sets
 * it to null if the token is missing, the user no longer exists, or the
 * account is inactive.
 */
async function loadCurrentUser(req, res, next) {
  if (!req.user?.userId) {
    req.currentUser = null;
    return next();
  }
  try {
    const { rows } = await query(
      "SELECT id, name, username, role, status FROM users WHERE id = $1",
      [req.user.userId]
    );
    const user = rows[0];
    req.currentUser = user && user.status === "active" ? user : null;
    next();
  } catch (err) {
    next(err);
  }
}

/** Reject unless someone is signed in and active. */
function requireAuth(req, res, next) {
  if (!req.currentUser) return res.status(401).json({ error: "Not signed in." });
  next();
}

/**
 * Reject unless the (freshly loaded, DB-authoritative) current user has
 * one of the given roles. Because this checks req.currentUser.role -- read
 * from the database on this exact request, not from anything the client
 * sent -- there is no request an Admin can craft, no ID they can edit, and
 * no field they can add to a JSON body that makes this see them as
 * super_admin. The only way req.currentUser.role becomes 'super_admin' is
 * if that is genuinely the value stored in their users row right now.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.currentUser) return res.status(401).json({ error: "Not signed in." });
    if (roles.length && !roles.includes(req.currentUser.role)) {
      return res.status(403).json({ error: "You do not have permission to do that." });
    }
    next();
  };
}

module.exports = { loadCurrentUser, requireAuth, requireRole };
