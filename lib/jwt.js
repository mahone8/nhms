/**
 * Stateless authentication for the production app.
 *
 * express-session (used by the legacy SQLite app in server.js) keeps
 * session data in server memory by default -- that works fine on a single
 * always-on process, but breaks on Vercel: every request can land on a
 * different, freshly-started serverless instance with no shared memory.
 *
 * The fix is to make the session self-contained: sign the user's identity
 * into a JWT, hand it to the browser as an httpOnly cookie, and verify the
 * signature on each request instead of looking anything up in server
 * memory. No session store of any kind is required.
 */
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "hms_token";
const TOKEN_TTL = "8h"; // matches the 8-hour session used by the legacy app

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set.");
  }
  return secret;
}

/** Sign a small payload (e.g. { userId, role }) into a JWT. */
function signAuthToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_TTL });
}

/** Verify a JWT and return its payload, or null if invalid/expired. */
function verifyAuthToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours, in ms
    path: "/",
  };
}

/** Set the auth cookie on a response. */
function setAuthCookie(res, payload) {
  res.cookie(COOKIE_NAME, signAuthToken(payload), cookieOptions());
}

/** Clear the auth cookie (sign-out). */
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/**
 * Express middleware: reads and verifies the auth cookie, attaching the
 * decoded payload to req.user. Does NOT reject the request if missing --
 * combine with requireRole() below for routes that need enforcement.
 */
function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  req.user = token ? verifyAuthToken(token) : null;
  next();
}

/** Express middleware factory: 401/403s unless req.user has one of `roles`. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in." });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do that." });
    }
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  signAuthToken,
  verifyAuthToken,
  setAuthCookie,
  clearAuthCookie,
  attachUser,
  requireRole,
};
