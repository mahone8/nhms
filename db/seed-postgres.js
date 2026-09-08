/**
 * DEMO/DEVELOPMENT DATA ONLY -- for the new PostgreSQL schema (db/migrations/).
 *
 * This is separate from db/seed.js, which still seeds the existing SQLite
 * app (server.js) and is left untouched for now. This file seeds the new
 * Postgres schema instead, and is intentionally NOT run by db/migrate.js --
 * per the spec's "no fake data in the final product" rule, seed data must
 * never run against a production database automatically.
 *
 * Scope for this phase: branches, rooms, and beds only (5 x 36 = 180 beds),
 * plus one Super Admin and one Admin login. Residents/charges/payments are
 * deliberately left for the Residents/Admissions/Payments phases, since
 * creating them correctly requires check-in transaction logic that hasn't
 * been built yet.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/seed-postgres.js
 *   npm run seed:pg
 */
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const BRANCHES = ["Nazzal", "Nooroxotel", "Ayesha", "Aqsa", "Velvet Rose"];

// 6 rooms of 4 Seater (24 beds) + 4 rooms of 3 Seater (12 beds) = 36 beds per branch.
const ROOM_PLAN = [
  { type: "4 Seater", bathroom: "Attached Bath", rent: 32000, count: 6 },
  { type: "3 Seater", bathroom: "Common Bath", rent: 27000, count: 4 },
];

async function seed() {
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
    const { rows: existing } = await client.query("SELECT COUNT(*) AS c FROM branches");
    if (Number(existing[0].c) > 0) {
      console.log("branches already has data -- skipping seed. Truncate tables first if you want to reseed.");
      return;
    }

    await client.query("BEGIN");

    for (const branchName of BRANCHES) {
      const { rows: [branch] } = await client.query(
        "INSERT INTO branches (name, capacity) VALUES ($1, 36) RETURNING id",
        [branchName]
      );

      let roomNumber = 1;
      let floor = 1;
      let roomsOnThisFloor = 0;
      for (const plan of ROOM_PLAN) {
        for (let i = 0; i < plan.count; i++) {
          if (roomsOnThisFloor >= 5) { floor++; roomsOnThisFloor = 0; }
          const { rows: [room] } = await client.query(
            `INSERT INTO rooms (branch_id, room_number, floor, room_type, bathroom_type, capacity, monthly_rent)
             VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING id`,
            [branch.id, String(roomNumber).padStart(3, "0"), String(floor), plan.type, plan.bathroom, plan.rent]
          );
          // capacity is overwritten automatically by the set_room_capacity trigger
          const bedCount = Number(plan.type[0]);
          for (let b = 1; b <= bedCount; b++) {
            await client.query(
              `INSERT INTO beds (branch_id, room_id, bed_number) VALUES ($1, $2, $3)`,
              [branch.id, room.id, b]
            );
          }
          roomNumber++;
          roomsOnThisFloor++;
        }
      }
    }

    const superAdminHash = bcrypt.hashSync("SuperAdmin123!", 10);
    const adminHash = bcrypt.hashSync("Admin123!", 10);
    await client.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES
       ('System Super Admin', 'superadmin', $1, 'super_admin'),
       ('Front Desk Admin', 'admin', $2, 'admin')`,
      [superAdminHash, adminHash]
    );

    await client.query("COMMIT");

    console.log("Seed complete: 5 branches, rooms, and 180 beds (36 per branch) created.");
    console.log("Super Admin login: superadmin / SuperAdmin123!");
    console.log("Admin login:       admin / Admin123!");
    console.log("(No residents seeded yet -- that logic belongs to a later phase.)");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = seed;
