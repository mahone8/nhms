const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { logAction } = require("../lib/audit");
const { generateMonthlyRentCharges } = require("../jobs/generate-monthly-rent");

const router = express.Router();

/**
 * Triggered by Vercel Cron (see vercel.json's "crons" entry), not by a
 * logged-in user -- there's no session to check requireRole against.
 * Instead this is protected by a shared secret Vercel sends as
 * `Authorization: Bearer <CRON_SECRET>` when a CRON_SECRET env var is
 * configured. Fails closed: if CRON_SECRET isn't set at all, this
 * endpoint refuses every request rather than ever running unauthenticated
 * in a public deployment.
 *
 * If you're running the monthly rent job from a CWP (or other) native
 * cron job instead, use `node jobs/generate-monthly-rent.js` directly --
 * this HTTP endpoint is only needed for Vercel's cron mechanism.
 */
router.get("/generate-monthly-rent", asyncHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "CRON_SECRET is not configured -- this endpoint is disabled." });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const summary = await generateMonthlyRentCharges();
  await logAction({
    action: "generate_monthly_rent", entityType: "system",
    metadata: summary, ipAddress: req.ip,
  });
  res.json(summary);
}));

module.exports = router;
