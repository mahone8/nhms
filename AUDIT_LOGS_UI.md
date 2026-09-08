# Audit Logs (UI) — Phase 20

The first Admin/Super Admin-facing UI for the Postgres app -- everything
through Phase 18 was backend-only for admin roles (only Phase 19's
Resident Portal had a frontend). This phase introduces a small,
extensible Admin Portal shell and gives it one section: browsing the
audit trail that's been correctly recorded since Phase 3.

## What's new

- `public/admin-portal/index.html` + `public/js/admin-portal-login.js` --
  login for Admin/Super Admin accounts, rejecting resident logins.
- `public/admin-portal/app.html` + `public/js/admin-portal-app.js` -- an
  app shell with a role-aware nav (each item declares which role it needs
  via `data-role`; items are hidden for a role that doesn't match) and one
  section: Audit Logs.

The shell is deliberately built to be extended, not just used once --
`data-role` on each nav button is the mechanism System Settings (Phase
21) will slot into next.

## Frontend hiding is a convenience here, not the security boundary -- verified directly

The nav item that would show Audit Logs to an Admin is hidden client-side
for that role. But hiding a button is not what actually stops an Admin
from seeing this data -- GET /api/audit-logs's requireRole("super_admin")
gate, built in Phase 3, is. Tested directly: logged in as Admin and hit
the API endpoint itself, bypassing the UI entirely -- still 403. The
page's loadAuditLogs() function has its own fallback message for this
exact case (a session expiring mid-view, or someone hitting the endpoint
directly), but the real enforcement was never the frontend's job.

## No new backend logic -- this phase is entirely a UI over already-correct data

GET /api/audit-logs and the append-only guarantee it reads from
(migration 014's trigger, verified back in Phase 1) haven't changed.
Every phase since 3 has been calling logAction() on its important writes
-- resident creation, check-in/check-out, transfers, payments,
room/rent modifications, notice creation, admin account changes -- so
this phase's job was purely to display what's already there correctly,
not to add new capture logic.

## What I actually tested (against the live app and real Postgres)

- All four new static files serve correctly.
- The test that actually matters: logged in as Admin and called
  GET /api/audit-logs directly (not through the hidden nav item) --
  still 403. The UI's role-based hiding and the API's actual enforcement
  are two separate things, and only the second one is real security;
  this confirmed it independently of the frontend.
- Super Admin successfully fetched real log entries, including one from
  the login just performed.
- Made a real room-rent change as Admin (monthlyRent: 32000 -> 33000),
  then confirmed as Super Admin that the resulting audit log entry
  captured the correct acting user (admin), role, both the old and new
  values, and a timestamp -- exactly the fields spec section 33 lists.
- Reverted the test change, re-ran Phase 2's JWT suite and the legacy
  app -- both still fully working.

## Trying it yourself

Visit /admin-portal/ in a browser, sign in as superadmin (from Phase 1's
seed data) to see the Audit Logs section, or as admin to confirm the
section is hidden for that role.

## What's next: Phase 21 -- System Settings

Spec section 34's Super-Admin-only configuration (hostel name, room
types, fee types, notification settings, etc.), backed by the key-value
system_settings table built in Phase 1. This phase adds its own section
to the same Admin Portal shell this phase introduced, gated the same
way.

Phases remaining after that (4 total): Security hardening (22),
Performance optimization (23), Complete QA (24), Vercel production
deployment verification (25).
