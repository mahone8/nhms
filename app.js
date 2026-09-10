/**
 * The PRODUCTION app -- Postgres-backed, stateless, designed to run
 * identically as a local Node process or as a Vercel serverless function
 * (see api/[...path].js). This is deliberately separate from server.js
 * (the legacy SQLite app), which is untouched and keeps working for local
 * demo purposes while this one is built up phase by phase.
 *
 * No express-session (in-memory, breaks on serverless) -- see lib/jwt.js
 * for the stateless replacement. No local file storage -- uploads will be
 * stored in Postgres or object storage, never on disk, once those routes
 * are built in later phases.
 */
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { pool } = require("./db/pool");
const { attachUser } = require("./lib/jwt");
const { loadCurrentUser } = require("./lib/rbac");

const app = express();

// Required on any host that sits behind a reverse proxy (Vercel, Bonto,
// Render, etc.) -- without this, express-rate-limit refuses to run at
// all when it sees an X-Forwarded-For header it's not configured to
// trust.
app.set("trust proxy", true);

// frameguard: false allows Bonto's internal iframe preview panel to embed the site
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));

app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(attachUser);
app.use(loadCurrentUser);

// Brute-force protection on login -- generous enough for normal typos,
// tight enough to slow down credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
  validate: { xForwardedForHeader: false },
});
app.use("/api/auth/login", loginLimiter);

// Serves public/ locally for parity with how Vercel serves it (as static
// files, automatically, without hitting this function at all). Harmless
// in both environments.
app.use(express.static(path.join(__dirname, "public")));

/**
 * Health check: proves the deployed function can actually reach the
 * database through the pooled client, not just that the process started.
 */
app.get("/api/health", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT now() AS db_time");
    res.json({ ok: true, dbTime: rows[0].db_time });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use("/api/auth", require("./routes-pg/auth"));
app.use("/api/users", require("./routes-pg/users"));
app.use("/api/audit-logs", require("./routes-pg/audit"));
app.use("/api/branches", require("./routes-pg/branches"));
app.use("/api/rooms", require("./routes-pg/rooms"));
app.use("/api/beds", require("./routes-pg/beds"));
app.use("/api/residents", require("./routes-pg/residents"));
app.use("/api/admissions", require("./routes-pg/admissions"));
app.use("/api", require("./routes-pg/checkin-checkout"));
app.use("/api", require("./routes-pg/transfers"));
app.use("/api/charges", require("./routes-pg/charges"));
app.use("/api/payments", require("./routes-pg/payments"));
app.use("/api/cron", require("./routes-pg/cron"));
app.use("/api/mess", require("./routes-pg/mess"));
app.use("/api/expenses", require("./routes-pg/expenses"));
app.use("/api/dashboard", require("./routes-pg/dashboard"));
app.use("/api/reports", require("./routes-pg/reports"));
app.use("/api/search", require("./routes-pg/search"));
app.use("/api/notices", require("./routes-pg/notices"));
app.use("/api/notifications", require("./routes-pg/notifications"));
app.use("/api/settings", require("./routes-pg/settings"));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Final error handler -- catches anything asyncHandler forwarded, or any
// other synchronous throw, and always responds with JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Production app (Postgres) running at http://0.0.0.0:${PORT}`);
  });
}