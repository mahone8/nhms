const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { logAction } = require("../lib/audit");
const { asyncHandler } = require("../lib/asyncHandler");

const router = express.Router();

// Every route below requires super_admin. This is the entire enforcement
// mechanism for "Admin must not manage Super Admin accounts, and must not
// promote themselves" -- Admin's token can never satisfy requireRole
// here, no matter what the request body says, because authorization is
// decided from req.currentUser.role (loaded fresh from the database by
// lib/rbac.js), not from anything the client sent.
router.use(requireRole("super_admin"));

function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username, role: u.role, status: u.status };
}

router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name, username, role, status, created_at FROM users ORDER BY id");
  res.json(rows.map(publicUser));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: "name, username, password, and role are all required." });
  }
  if (!["super_admin", "admin", "resident"].includes(role)) {
    return res.status(400).json({ error: "role must be super_admin, admin, or resident." });
  }
  const existing = await query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length) return res.status(409).json({ error: "That username is already taken." });

  const passwordHash = bcrypt.hashSync(password, 10);
  const { rows } = await query(
    "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, username, role, status",
    [name, username, passwordHash, role]
  );
  const created = rows[0];

  await logAction({
    userId: req.currentUser.id,
    role: req.currentUser.role,
    action: "create_user",
    entityType: "user",
    entityId: created.id,
    newValues: { name, username, role },
    ipAddress: req.ip,
  });

  res.status(201).json(publicUser(created));
}));

router.patch("/:id/role", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body || {};
  if (!["super_admin", "admin", "resident"].includes(role)) {
    return res.status(400).json({ error: "role must be super_admin, admin, or resident." });
  }
  const { rows: existingRows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "User not found." });

  const { rows } = await query(
    "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, username, role, status",
    [role, id]
  );

  await logAction({
    userId: req.currentUser.id,
    role: req.currentUser.role,
    action: "change_user_role",
    entityType: "user",
    entityId: id,
    oldValues: { role: existing.role },
    newValues: { role },
    ipAddress: req.ip,
  });

  res.json(publicUser(rows[0]));
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status must be active or inactive." });
  }
  const { rows: existingRows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "User not found." });

  const { rows } = await query(
    "UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, username, role, status",
    [status, id]
  );

  await logAction({
    userId: req.currentUser.id,
    role: req.currentUser.role,
    action: "change_user_status",
    entityType: "user",
    entityId: id,
    oldValues: { status: existing.status },
    newValues: { status },
    ipAddress: req.ip,
  });

  res.json(publicUser(rows[0]));
}));

module.exports = router;
