/**
 * Creates exactly one Super Admin account. This is the safe way to
 * bootstrap a REAL production deployment -- db/seed-postgres.js's
 * "superadmin / SuperAdmin123!" account is demo data only, with a
 * password documented in this very repository's own docs. Never use it
 * for anything but local development.
 *
 * There's no API route that can do this instead: POST /api/users
 * (routes-pg/users.js) requires already being signed in as a Super
 * Admin, which is exactly the chicken-and-egg problem a brand new,
 * empty production database has.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/create-super-admin.js \
 *     --name "Jane Doe" --username jane --password "a real strong password"
 *
 * Refuses to run if any super_admin already exists, so it can't be used
 * to silently create a second one by accident.
 */
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const { name, username, password } = parseArgs();
  if (!name || !username || !password) {
    console.error("Usage: node db/create-super-admin.js --name \"Full Name\" --username someuser --password \"a strong password\"");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters. Use a real, unique password -- not a demo one.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: existing } = await client.query("SELECT username FROM users WHERE role = 'super_admin'");
    if (existing.length) {
      console.error(
        `A Super Admin account already exists (${existing.map((r) => r.username).join(", ")}). ` +
        `This script only creates the FIRST one. To add more, sign in as that Super Admin and use POST /api/users.`
      );
      process.exit(1);
    }

    const existingUsername = await client.query("SELECT id FROM users WHERE username = $1", [username]);
    if (existingUsername.rows.length) {
      console.error("That username is already taken.");
      process.exit(1);
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await client.query(
      "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, 'super_admin')",
      [name, username, passwordHash]
    );
    console.log(`Super Admin account created: ${username}`);
    console.log("Sign in at /admin-portal/ (or /api/auth/login) with the password you provided.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
