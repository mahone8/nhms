# Hostel Management System

A multi-branch hostel management system with a real SQLite database, an Express
API, and separate admin/resident web dashboards. No build step, no external
database server to install.

> **In progress:** this app is being rebuilt into a production system on
> PostgreSQL/Neon + Vercel, per a larger specification, in phases.
> - Phase 1 (Postgres schema + migrations) — done, see [`db/POSTGRES_SCHEMA.md`](db/POSTGRES_SCHEMA.md)
> - Phase 2 (Vercel-compatible backend architecture) — done, see [`VERCEL_ARCHITECTURE.md`](VERCEL_ARCHITECTURE.md)
> - Phase 3 (Authentication and RBAC) — done, see [`AUTH_RBAC.md`](AUTH_RBAC.md)
> - Phase 4 (Branches / Rooms / Beds) — done, see [`BRANCHES_ROOMS_BEDS.md`](BRANCHES_ROOMS_BEDS.md)
> - Phase 5 (Residents) — done, see [`RESIDENTS.md`](RESIDENTS.md)
> - Phase 6 (Admissions) — done, see [`ADMISSIONS.md`](ADMISSIONS.md)
> - Phase 7 (Check-in / Check-out) — done, see [`CHECKIN_CHECKOUT.md`](CHECKIN_CHECKOUT.md)
> - Phase 8 (Transfers / Stay history) — done, see [`TRANSFERS_STAY_HISTORY.md`](TRANSFERS_STAY_HISTORY.md)
> - Phase 9 (Rent / Charges) — done, see [`RENT_CHARGES.md`](RENT_CHARGES.md)
> - Phase 10 (Payments / Receipts) — done, see [`PAYMENTS_RECEIPTS.md`](PAYMENTS_RECEIPTS.md)
> - Phase 11 (Automatic monthly rent) — done, see [`AUTOMATIC_MONTHLY_RENT.md`](AUTOMATIC_MONTHLY_RENT.md)
> - Phase 12 (Common Mess) — done, see [`COMMON_MESS.md`](COMMON_MESS.md)
> - Phase 13 (Expenses) — done, see [`EXPENSES.md`](EXPENSES.md)
> - Phase 14 (Branch Revenue / Financial Analysis) — done, see [`BRANCH_EARNINGS.md`](BRANCH_EARNINGS.md)
> - Phase 15 (Dashboard) — done, see [`DASHBOARD.md`](DASHBOARD.md)
> - Phase 16 (Reports) — done, see [`REPORTS.md`](REPORTS.md)
> - Phase 17 (Global Search) — done, see [`GLOBAL_SEARCH.md`](GLOBAL_SEARCH.md)
> - Phase 18 (Notices / Notifications) — done, see [`NOTICES_NOTIFICATIONS.md`](NOTICES_NOTIFICATIONS.md)
> - Phase 19 (Resident Portal UI) — done, see [`RESIDENT_PORTAL.md`](RESIDENT_PORTAL.md)
> - Phase 20 (Audit Logs UI) — done, see [`AUDIT_LOGS_UI.md`](AUDIT_LOGS_UI.md)
> - Phases 21-25 (System Settings, Security hardening, Performance, QA, Deployment verification) — done: `routes-pg/settings.js`, `admin-portal` Settings tab, helmet + rate limiting + compression in `app.js`, `scripts/qa-smoke-test.js` (17/17 passing), `vercel.json`/`api/[...path].js` validated.
>
> **All 25 phases complete.** See [`DEPLOYMENT.md`](DEPLOYMENT.md) for a
> full deployment guide (Vercel+Neon or CWP VPS).
>
> The app below still runs on SQLite for now; nothing here has been broken
> by that work.

## Branches

Nazzal · Nooroxotel · Ayesha · Aqsa · Velvet Rose — 36 beds each (180 beds total).

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite, via Node's built-in `node:sqlite` module (file: `db/hostel.db`) — no native compilation, no separate DB server
- **Auth:** session cookies (`express-session`), passwords hashed with `bcryptjs`
- **File uploads:** `multer`, stores the menu image on disk under `public/uploads/menu/`
- **Frontend:** plain HTML/CSS/JS (no framework, no build tool) served as static files by Express

## Requirements

- Node.js **22.5 or later** (needed for `node:sqlite`). Check with `node --version`.

## Setup

```bash
npm install
npm start
```

The first time it runs, the server automatically creates `db/hostel.db`, sets
up all tables, and seeds demo data (branches, beds, sample residents, payment
history, and demo accounts). On later runs it detects the existing data and
leaves it alone.

Open **http://localhost:3000** in your browser.

To wipe everything and start over with fresh demo data, stop the server and
delete `db/hostel.db`, then run `npm start` again (or `npm run seed` to reseed
without starting the server).

## Demo logins

| Role     | Username  | Password      |
|----------|-----------|---------------|
| Admin    | `admin`   | `admin123`    |
| Resident | `ayesha34`| `resident123` |

(Run the app and check the Accounts tab as admin for the full list of seeded
resident logins — one per branch.)

## What's included

- **Branches & beds** — a 6×6 bed grid per branch; click any bed to allocate a
  new resident or view/vacate an existing one.
- **Residents** — a searchable, filterable table of everyone across all branches.
- **Payments** — full payment history per resident (paid / pending / overdue),
  filter by branch or status, mark payments paid, record new payment entries.
- **Menu** — one shared menu image for all five branches; admin uploads a PNG
  or JPG from their computer, replacing the previous one; residents can view it.
- **Accounts** — separate admin and resident logins; admin can create more of
  either.

## Project structure

```
hostel-system/
  server.js              Express app entry point
  db/
    database.js           SQLite connection + schema
    seed.js                One-time demo data seeding
    hostel.db              (generated on first run)
  middleware/
    auth.js                Session-based route guards (requireAdmin, requireResident)
  routes/
    auth.js, branches.js, residents.js, payments.js, menu.js, accounts.js
  public/
    index.html              Login page
    admin/index.html         Admin dashboard shell
    resident/index.html      Resident dashboard shell
    css/style.css
    js/login.js, admin.js, resident.js
    uploads/menu/            Uploaded menu images live here
```

## Notes for production use

This is set up to run comfortably on a single small server (a VPS, or
something like a Raspberry Pi at the front desk) — SQLite handles that scale
easily. Before putting it in front of real residents' data, you'd want to:

- Set a strong, unique `SESSION_SECRET` environment variable (a random default
  is used otherwise).
- Serve it over HTTPS (e.g. behind Nginx or Caddy) so session cookies and
  login credentials aren't sent in the clear.
- Set `cookie.secure: true` in `server.js` once you're on HTTPS.
- Take regular backups of `db/hostel.db` — it's a single file, so copying it
  is enough.
