# Database (PostgreSQL / Neon) — Phase 1

This is the new production database layer, built to the master transformation
spec. It lives alongside the existing SQLite app (`db/database.js`,
`db/seed.js`, `server.js`) rather than replacing it yet — that swap is
Phase 2 (Vercel-compatible backend architecture). Nothing here has touched
or broken the running SQLite app.

## What's in this phase

- `db/migrations/*.sql` — 17 ordered, idempotent migration files that build
  the full schema: `users`, `branches`, `rooms`, `beds`, `admissions`,
  `residents`, `resident_assignments` (stay history), `charges`, `payments`,
  `expenses`, the Common Mess tables, `notices`/`notifications`,
  `audit_logs`, `staff`, and `system_settings`.
- `db/migrate.js` — a small Node script (uses `pg`, reads `DATABASE_URL`)
  that applies whichever migration files haven't been applied yet, tracked
  in a `schema_migrations` table. Safe to run repeatedly.
- `db/seed-postgres.js` — **demo data only**, clearly separated from
  migrations per the "no fake data in production" rule. Seeds 5 branches,
  realistic rooms (mix of 3/4-seater), all 180 beds, and one Super Admin +
  one Admin login. Deliberately does **not** seed residents/charges/payments
  yet — that requires the check-in transaction logic, which is a later
  phase. Never run this against a real production database.

## Why a `users` table instead of separate admin/resident account tables

The old SQLite app had `admin_accounts` and `resident_accounts` as separate
tables. The new schema unifies them into one `users` table with a `role`
column (`super_admin` / `admin` / `resident`), matching the spec's suggested
design and making RBAC (Phase 3) straightforward: one login table, one place
to check `role`. `residents.user_id` links a resident record to their login.

## What the schema enforces by itself (not just in application code)

- **Room capacity matches room type automatically** — a trigger sets
  `rooms.capacity` from `room_type` on every insert/update; the app never
  has to compute or trust a client-sent capacity.
- **A bed's branch always matches its room's branch** — synced by trigger,
  so this can never drift out of sync.
- **A room can never hold more beds than its capacity, and a branch can
  never hold more beds than its configured capacity** (36 by default,
  raisable per branch by a Super Admin) — enforced by a trigger that raises
  an exception on the insert, not just checked in application code.
- **No duplicate active occupancy of a bed** — a partial unique index on
  `residents(bed_id) WHERE status = 'active'`.
- **Only one open stay per resident and per bed at a time** — partial
  unique indexes on `resident_assignments`.
- **Monthly rent generation is idempotent** — a partial unique index on
  `charges(resident_id, period_month) WHERE type = 'monthly_rent'` means
  running the auto-rent job twice for the same resident/month is a no-op,
  not a duplicate charge.
- **Audit logs are genuinely append-only** — a trigger blocks `UPDATE` and
  `DELETE` at the database level, so this holds even against a direct SQL
  statement or an application bug, not just because the UI has no edit
  button.

All of the above were tested directly against a live local Postgres 16
instance during development (branch/room capacity limits, duplicate
occupancy, idempotent rent charges, and audit-log immutability were each
verified to actually reject the bad operation).

## Running it yourself

1. Create a free [Neon](https://neon.tech) project (or use any Postgres 13+).
2. Copy `.env.example` to `.env` and paste your connection string into
   `DATABASE_URL`.
3. Install dependencies: `npm install`
4. Apply migrations: `npm run migrate`
5. (Optional, dev only) Seed demo branches/rooms/beds:
   `npm run seed:pg`

To test locally without Neon, any Postgres 13+ works — just point
`DATABASE_URL` at it, e.g.:
`postgres://user:password@localhost:5432/hms_dev`

## Not yet done (upcoming phases)

- The Express app (`server.js`) still talks to SQLite. Swapping it onto
  this schema, and making it Vercel-compatible (no long-running server,
  no local file storage), is Phase 2.
- Authentication/RBAC against the new `users` table is Phase 3.
- Admissions/check-in/check-out/transfer transaction logic, automatic
  monthly rent generation (as a Vercel cron-compatible job), reports,
  dashboard, resident portal, and audit-log writing from the app are
  later phases per the spec's own implementation order (section 53).
