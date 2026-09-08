function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function requireResident(req, res, next) {
  if (!req.session.user || req.session.user.role !== "resident") {
    return res.status(403).json({ error: "Resident access required." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireResident };
