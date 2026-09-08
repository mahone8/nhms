/**
 * Runtime database access for the production (Postgres) app -- distinct
 * from db/migrate.js and db/seed-postgres.js, which open their own
 * short-lived Client for one-off scripts.
 *
 * On Vercel, a serverless function's module scope can be reused across
 * "warm" invocations of the same instance. If we created a new pg.Pool on
 * every request, we'd quickly exhaust Neon's connection limit under any
 * real concurrency. Instead we cache the pool on `global`, so a warm
 * invocation reuses the same pool instead of opening new connections.
 *
 * In production, DATABASE_URL should be Neon's *pooled* connection string
 * (the one with "-pooler" in the hostname) -- see db/POSTGRES_SCHEMA.md.
 */
// Loads variables from a .env file if one exists (silently does nothing
// otherwise) -- this is a no-op on Vercel, where env vars are injected
// directly, but makes local dev and a CWP cron job both "just work" by
// pointing at the same .env file the app itself uses.
require("dotenv").config();

const { Pool } = require("pg");

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
    // Keep this small -- each serverless instance holds its own pool, and
    // many instances can be warm at once. A handful of connections per
    // instance is plenty; Neon's pooler handles the rest.
    max: 5,
    idleTimeoutMillis: 30000,
  });
}

if (!global.__hmsPgPool) {
  global.__hmsPgPool = createPool();
}
const pool = global.__hmsPgPool;

/** Run a single query using the shared pool. */
function query(text, params) {
  return pool.query(text, params);
}

/** Borrow a client for a multi-statement transaction. Caller must release() it. */
function getClient() {
  return pool.connect();
}

/** Run `fn` inside a BEGIN/COMMIT transaction, rolling back on any error. */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction };
