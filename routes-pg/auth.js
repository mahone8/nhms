const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db/pool");
const { setAuthCookie, clearAuthCookie } = require("../lib/jwt");
const { requireAuth } = require("../lib/rbac");
const { logAction } = require("../lib/audit");
const { asyncHandler } = require("../lib/asyncHandler");

const router = express.Router();

function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username, role: u.role };
}

router.post("/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const { rows } = await query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];

  // Same error either way, on purpose -- don't reveal whether a username
  // exists or whether it exists but is deactivated.
  const invalid = !user || user.status !== "active" || !bcrypt.compareSync(password, user.password_hash);
  if (invalid) {
    await logAction({
      action: "login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      metadata: { username },
      ipAddress: req.ip,
    });
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  setAuthCookie(res, { userId: user.id, role: user.role });
  await logAction({
    userId: user.id,
    role: user.role,
    action: "login",
    entityType: "user",
    entityId: user.id,
    ipAddress: req.ip,
  });
  res.json({ user: publicUser(user) });
}));

router.post("/logout", requireAuth, asyncHandler(async (req, res) => {
  await logAction({
    userId: req.currentUser.id,
    role: req.currentUser.role,
    action: "logout",
    entityType: "user",
    entityId: req.currentUser.id,
    ipAddress: req.ip,
  });
  clearAuthCookie(res);
  res.json({ ok: true });
}));

router.get("/me", (req, res) => {
  res.json({ user: req.currentUser ? publicUser(req.currentUser) : null });
});

module.exports = router;
