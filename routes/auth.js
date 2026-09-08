const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");

const router = express.Router();

router.post("/login", (req, res) => {
  const { role, username, password } = req.body || {};
  if (!role || !username || !password) {
    return res.status(400).json({ error: "Role, username, and password are all required." });
  }

  if (role === "admin") {
    const account = db.prepare("SELECT * FROM admin_accounts WHERE username = ?").get(username);
    if (!account || !bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    req.session.user = { role: "admin", id: account.id, name: account.name, username: account.username };
    return res.json({ role: "admin", name: account.name, username: account.username });
  }

  if (role === "resident") {
    const account = db.prepare("SELECT * FROM resident_accounts WHERE username = ?").get(username);
    if (!account || !bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(account.resident_id);
    if (!resident) {
      return res.status(404).json({ error: "This resident record no longer exists." });
    }
    req.session.user = { role: "resident", id: account.id, residentId: resident.id, username: account.username };
    return res.json({ role: "resident", residentId: resident.id, name: resident.name, username: account.username });
  }

  return res.status(400).json({ error: "Role must be 'admin' or 'resident'." });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

module.exports = router;
