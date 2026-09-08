const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAdmin, (req, res) => {
  const admins = db.prepare("SELECT id, name, username FROM admin_accounts ORDER BY id").all();
  const residentAccounts = db.prepare(
    `SELECT resident_accounts.id, resident_accounts.username, resident_accounts.resident_id AS residentId,
            residents.name AS residentName, branches.name AS branch
     FROM resident_accounts
     JOIN residents ON resident_accounts.resident_id = residents.id
     JOIN branches ON residents.branch_id = branches.id
     ORDER BY resident_accounts.id`
  ).all();
  res.json({ admins, residents: residentAccounts });
});

router.post("/admin", requireAdmin, (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "Name, username, and password are required." });
  }
  const existing = db.prepare("SELECT id FROM admin_accounts WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "That username is already taken." });

  const hash = bcrypt.hashSync(password, 10);
  const id = Number(db.prepare("INSERT INTO admin_accounts (name, username, password_hash) VALUES (?, ?, ?)").run(name, username, hash).lastInsertRowid);
  res.status(201).json({ id, name, username });
});

router.post("/resident", requireAdmin, (req, res) => {
  const { residentId, username, password } = req.body || {};
  if (!residentId || !username || !password) {
    return res.status(400).json({ error: "residentId, username, and password are required." });
  }
  const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(residentId);
  if (!resident) return res.status(404).json({ error: "Resident not found." });

  const existingLink = db.prepare("SELECT id FROM resident_accounts WHERE resident_id = ?").get(residentId);
  if (existingLink) return res.status(409).json({ error: "This resident already has a login account." });

  const existingUsername = db.prepare("SELECT id FROM resident_accounts WHERE username = ?").get(username);
  if (existingUsername) return res.status(409).json({ error: "That username is already taken." });

  const hash = bcrypt.hashSync(password, 10);
  const id = Number(
    db.prepare("INSERT INTO resident_accounts (username, password_hash, resident_id) VALUES (?, ?, ?)").run(username, hash, residentId).lastInsertRowid
  );
  res.status(201).json({ id, username, residentId });
});

module.exports = router;
