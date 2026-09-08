/**
 * Applies every .sql file in db/migrations/, in filename order, that hasn't
 * already been recorded in schema_migrations. Safe to run repeatedly
 * (idempotent) and safe to run against Neon or any standard Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/migrate.js
 *   npm run migrate
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Point it at your Neon (or any Postgres) connection string.");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // Bootstrap: the tracking table itself is migration 000, but we need it
    // to exist before we can even check what's been applied.
    const bootstrapPath = path.join(MIGRATIONS_DIR, "000_migration_history.sql");
    await client.query(fs.readFileSync(bootstrapPath, "utf8"));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: applied } = await client.query("SELECT name FROM schema_migrations");
    const appliedNames = new Set(applied.map((r) => r.name));

    let appliedCount = 0;
    for (const file of files) {
      if (appliedNames.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying ${file} ...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [file]);
        await client.query("COMMIT");
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (appliedCount === 0) {
      console.log("Database is already up to date -- nothing to apply.");
    } else {
      console.log(`Applied ${appliedCount} migration(s) successfully.`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = migrate;
