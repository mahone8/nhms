const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("../db/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads", "menu");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
    cb(null, `menu-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") {
      cb(null, true);
    } else {
      cb(new Error("Only PNG or JPG images are allowed."));
    }
  },
});

router.get("/", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM menu WHERE id = 1").get();
  if (!row) return res.json({ fileName: null, filePath: null, uploadedAt: null });
  res.json({
    fileName: row.file_name,
    filePath: row.file_path ? `/uploads/menu/${path.basename(row.file_path)}` : null,
    uploadedAt: row.uploaded_at,
  });
});

router.post("/", requireAdmin, (req, res) => {
  upload.single("menuImage")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    // remove the previous menu image from disk, if any
    const existing = db.prepare("SELECT * FROM menu WHERE id = 1").get();
    if (existing && existing.file_path) {
      const oldPath = path.join(UPLOAD_DIR, path.basename(existing.file_path));
      fs.unlink(oldPath, () => {});
    }

    const uploadedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO menu (id, file_name, file_path, uploaded_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET file_name = excluded.file_name, file_path = excluded.file_path, uploaded_at = excluded.uploaded_at`
    ).run(req.file.originalname, req.file.filename, uploadedAt);

    res.status(201).json({
      fileName: req.file.originalname,
      filePath: `/uploads/menu/${req.file.filename}`,
      uploadedAt,
    });
  });
});

module.exports = router;
