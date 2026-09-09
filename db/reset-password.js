/**
 * Resets the password for an existing user (typically the Super Admin).
 * Uses the same bcrypt hashing scheme as db/create-super-admin.js, so the
 * result is guaranteed to match what the login route expects.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/reset-password.js \
 *     --username youruser --password "a real strong password"
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
  const { username, password } = parseArgs();
  if (!username || !password) {
    console.error('Usage: node db/reset-password.js --username someuser --password "a strong password"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
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
    const { rows: existing } = await client.query(
      "SELECT id, username FROM users WHERE username = $1",
      [username]
    );

    if (!existing.length) {
      console.error(`No user found with username "${username}".`);
      process.exit(1);
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    await client.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2",
      [passwordHash, username]
    );

    console.log(`Password updated for user: ${username}`);
    console.log("Sign in at /admin-portal/ (or /api/auth/login) with the new password.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
