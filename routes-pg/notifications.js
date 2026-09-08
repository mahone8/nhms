const express = require("express");
const { query } = require("../db/pool");
const { requireRole } = require("../lib/rbac");
const { asyncHandler } = require("../lib/asyncHandler");
const { computeDues } = require("../lib/dues");
const { logAction } = require("../lib/audit");

const router = express.Router();

// --- Resident's own notifications -------------------------------------------
router.get("/me", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    [req.currentUser.id]
  );
  res.json(rows);
}));

// IDOR-safe: only marks a notification read if it belongs to the caller
// -- the WHERE clause checks user_id, not just the notification's own id.
router.patch("/me/:id/read", requireRole("resident"), asyncHandler(async (req, res) => {
  const { rows } = await query(
    "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *",
    [req.params.id, req.currentUser.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Notification not found." });
  res.json(rows[0]);
}));

// --- Admin / Super Admin: generate payment reminders ------------------------
/**
 * Spec section 27: residents should see "Relevant payment reminders".
 * Rather than fabricating these into the notices system (which is
 * broadcast content -- title/message/target, no per-recipient read
 * state), this uses the `notifications` table's actual purpose: a
 * per-user, per-item notification with an is_read flag, exactly the
 * right shape for "you owe rent, here's a reminder, dismiss it once
 * seen."
 *
 * Dedup rule: don't create a new reminder for a resident who already has
 * an unread one -- otherwise every run of this (however it's triggered)
 * would pile up duplicate reminders for someone who hasn't dealt with
 * the first one yet.
 */
router.post("/generate-payment-reminders", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { rows: activeResidents } = await query(
    `SELECT residents.id AS resident_id, residents.user_id, residents.full_name
     FROM residents WHERE residents.status = 'active' AND residents.user_id IS NOT NULL`
  );

  const created = [];
  for (const r of activeResidents) {
    const dues = await computeDues(r.resident_id);
    if (dues.status !== "due" && dues.status !== "overdue") continue;

    const { rows: existingUnread } = await query(
      "SELECT id FROM notifications WHERE user_id = $1 AND type = 'payment_reminder' AND is_read = false",
      [r.user_id]
    );
    if (existingUnread.length) continue; // already has one pending

    const { rows } = await query(
      `INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id)
       VALUES ($1, $2, $3, 'payment_reminder', 'resident', $4) RETURNING id`,
      [
        r.user_id,
        dues.status === "overdue" ? "Payment overdue" : "Payment due",
        `You have an outstanding balance of ${dues.remainingBalance}. Please arrange payment at your earliest convenience.`,
        r.resident_id,
      ]
    );
    created.push({ residentId: r.resident_id, notificationId: rows[0].id, remainingBalance: dues.remainingBalance });
  }

  await logAction({
    userId: req.currentUser.id, role: req.currentUser.role,
    action: "generate_payment_reminders", entityType: "system",
    metadata: { createdCount: created.length, totalActiveResidents: activeResidents.length }, ipAddress: req.ip,
  });

  res.json({ createdCount: created.length, totalActiveResidents: activeResidents.length, created });
}));

module.exports = router;
