const express = require("express");
const db = require("../db/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function pad(n) { return String(n).padStart(2, "0"); }
function monthKeyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function monthLabelOf(d) { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }

// List all branches with bed counts
router.get("/", requireAuth, (req, res) => {
  const branches = db.prepare("SELECT * FROM branches ORDER BY id").all();
  const result = branches.map((b) => {
    const total = db.prepare("SELECT COUNT(*) AS c FROM beds WHERE branch_id = ?").get(b.id).c;
    const occupied = db.prepare("SELECT COUNT(*) AS c FROM beds WHERE branch_id = ? AND resident_id IS NOT NULL").get(b.id).c;
    return { id: b.id, name: b.name, totalBeds: total, occupiedBeds: occupied };
  });
  res.json(result);
});

// List beds (with resident info) for one branch
router.get("/:branchId/beds", requireAuth, (req, res) => {
  const branchId = Number(req.params.branchId);
  const beds = db.prepare("SELECT * FROM beds WHERE branch_id = ? ORDER BY bed_number").all(branchId);
  const result = beds.map((bed) => {
    let resident = null;
    if (bed.resident_id) {
      resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(bed.resident_id);
    }
    return {
      id: bed.id,
      bedNumber: bed.bed_number,
      resident: resident && {
        id: resident.id,
        name: resident.name,
        phone: resident.phone,
        cnic: resident.cnic,
        monthlyFee: resident.monthly_fee,
        joinDate: resident.join_date,
      },
    };
  });
  res.json(result);
});

// Allocate a vacant bed to a new resident (admin only)
router.post("/beds/:bedId/allocate", requireAdmin, (req, res) => {
  const bedId = Number(req.params.bedId);
  const { name, phone, cnic, monthlyFee } = req.body || {};
  if (!name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: "Name and phone are required." });
  }
  const bed = db.prepare("SELECT * FROM beds WHERE id = ?").get(bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });
  if (bed.resident_id) return res.status(409).json({ error: "This bed is already occupied." });

  const fee = Number(monthlyFee) || 28000;
  const joinDate = new Date().toISOString().slice(0, 10);

  const residentId = Number(
    db.prepare(
      "INSERT INTO residents (name, phone, cnic, branch_id, bed_id, monthly_fee, join_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(name.trim(), phone.trim(), (cnic || "").trim(), bed.branch_id, bed.id, fee, joinDate).lastInsertRowid
  );
  db.prepare("UPDATE beds SET resident_id = ? WHERE id = ?").run(residentId, bed.id);

  const now = new Date();
  db.prepare(
    "INSERT INTO payments (resident_id, month_key, month_label, amount, status, paid_date) VALUES (?, ?, ?, ?, 'pending', NULL)"
  ).run(residentId, monthKeyOf(now), monthLabelOf(now), fee);

  res.status(201).json({ residentId });
});

// Vacate a bed / remove its resident (admin only)
router.post("/beds/:bedId/vacate", requireAdmin, (req, res) => {
  const bedId = Number(req.params.bedId);
  const bed = db.prepare("SELECT * FROM beds WHERE id = ?").get(bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });
  if (!bed.resident_id) return res.status(409).json({ error: "This bed is already vacant." });

  const residentId = bed.resident_id;
  db.prepare("UPDATE beds SET resident_id = NULL WHERE id = ?").run(bedId);
  db.prepare("DELETE FROM resident_accounts WHERE resident_id = ?").run(residentId);
  db.prepare("DELETE FROM payments WHERE resident_id = ?").run(residentId);
  db.prepare("DELETE FROM residents WHERE id = ?").run(residentId);

  res.json({ ok: true });
});

module.exports = router;
