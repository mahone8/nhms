const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "hostel.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS beds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    bed_number INTEGER NOT NULL,
    resident_id INTEGER,
    UNIQUE(branch_id, bed_number)
  );

  CREATE TABLE IF NOT EXISTS residents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    cnic TEXT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    bed_id INTEGER NOT NULL REFERENCES beds(id),
    monthly_fee INTEGER NOT NULL DEFAULT 0,
    join_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    month_key TEXT NOT NULL,
    month_label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('paid','pending','overdue')),
    paid_date TEXT
  );

  CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    file_name TEXT,
    file_path TEXT,
    uploaded_at TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resident_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    resident_id INTEGER NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE
  );
`);

module.exports = db;
