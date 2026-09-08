# Authentication and RBAC — Phase 3

Real login/logout backed by the `users` table, and role-based access
control that's enforced on every request from the database, not trusted
from anything the client sends. This builds directly on Phase 2's
`lib/jwt.js` (the token mechanism) and Phase 1's schema.

## The three roles, and nothing else

`users.role` is a CHECK constraint: `super_admin`, `admin`, or `resident`
only (migration 002). There is no receptionist, accountant, or branch
manager role anywhere in the code or schema — per the spec, staff records
can exist (Phase 1's `staff` table) without ever getting a login account.

## What's new

| File | Purpose |
|---|---|
| `lib/rbac.js` | `loadCurrentUser` re-reads the user's row from the database on *every* request (not just at login) and attaches it as `req.currentUser`. `requireRole(...roles)` and `requireAuth` authorize off that DB-sourced value. |
| `lib/audit.js` | Writes to the append-only `audit_logs` table from Phase 1. |
| `lib/asyncHandler.js` | Wraps async route handlers so a rejected promise reaches Express's error handler instead of hanging or crashing — needed because none of this worked before without it (see "What I tested" below). |
| `routes-pg/auth.js` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. |
| `routes-pg/users.js` | User management — entirely `super_admin`-only. |
| `routes-pg/audit.js` | `GET /api/audit-logs` — entirely `super_admin`-only. |

## Why every request re-reads the database instead of trusting the token

A JWT's signature proves it wasn't forged — it does *not* prove the
account is still active, or still has the role it had when the token was
issued. Spec section 40 is explicit that authorization must check
"authentication, active status, role, permission, resource access" on
**every** protected request. So `loadCurrentUser` looks the user up fresh
each time; `requireRole` never looks at the JWT's role claim directly, only
at what's currently in `req.currentUser.role` from that lookup.

This is what makes the following true as *enforced facts*, not just
application conventions:

- **An Admin cannot become Super Admin by editing a request, changing a
  role value in dev tools, or crafting a POST/PATCH directly.** Every
  route that would let someone act as `super_admin` requires
  `req.currentUser.role === 'super_admin'`, and that value comes from the
  database, keyed off a userId the JWT signature guarantees is genuine.
  There is no field in any request body this checks.
- **Admin cannot manage Super Admin accounts, or view Audit Logs.**
  `routes-pg/users.js` and `routes-pg/audit.js` both start with
  `router.use(requireRole("super_admin"))` — Admin's requests never get
  past that line, for any operation those files expose.
- **Deactivating an account takes effect immediately, not at next login.**
  A token issued at login is valid (by signature) for 8 hours regardless
  of what happens to the account afterward — but if `loadCurrentUser`
  finds `status != 'active'` on this request, `req.currentUser` is `null`
  and every protected route rejects it, even though the token itself
  hasn't expired.

## What I actually tested (not just wrote)

All of this was run against the live app and a real Postgres database,
using the Super Admin and Admin accounts seeded in Phase 1 plus one
throwaway `resident`-role test account:

- Logged in as all three roles; each got the right `role` back and a
  working session via `/api/auth/me`. Wrong password → `401`.
- **Admin → `GET /api/audit-logs` → `403`.** Super Admin → `200` with real
  log entries, correctly attributed to the acting user.
- **Admin → `POST /api/users` (create an account) → `403`.**
- **Admin → `PATCH /api/users/2/role` with `{"role":"super_admin"}` (self-
  promotion attempt) → `403`.**
- **Resident → both of the above → `403`.**
- Super Admin → creating a user and changing a role both succeeded.
- **The live-deactivation test:** logged in as Admin, confirmed
  `/api/auth/me` worked, had Super Admin flip that account's `status` to
  `inactive`, then reused the *exact same, still cryptographically valid,
  unexpired* Admin cookie — got `{"user": null}` from `/me` and `401` from
  a role-gated route. Reactivated and it worked again immediately. This is
  the concrete proof that "verify user is active" happens per-request.
- **Found and fixed a real bug in the process:** deleting a user with
  audit history failed with a confusing "audit_logs is append-only" error
  instead of a clear one, because the FK's `ON DELETE SET NULL` was
  issuing an `UPDATE` against the append-only table. Fixed in migration
  `017_fix_audit_log_fk.sql` by changing it to `ON DELETE RESTRICT` —
  which is also the more correct behavior: a user with audit history
  should never be hard-deleted, only deactivated. Verified: deleting such
  a user now fails with a clear FK error, deactivating it works, and a
  user with *no* audit history can still be deleted cleanly.
- Re-ran `npm run test:jwt` (Phase 2's suite) afterward — still all
  passing.
- Started the legacy SQLite app (`server.js`) after all of the above and
  confirmed it still logs in and serves pages exactly as before.

## Trying it yourself

```bash
export JWT_SECRET=... DATABASE_URL=...
npm run migrate      # picks up 017_fix_audit_log_fk.sql if you're updating from Phase 2
npm run dev:prod
curl -c cookies.txt -X POST localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"SuperAdmin123!"}'
curl -b cookies.txt localhost:3001/api/audit-logs
```

## Not yet done (upcoming phases)

- No feature routes exist yet beyond auth/users/audit — branches, rooms,
  beds, residents, admissions, payments, etc. all get built on top of this
  same `requireRole(...)` pattern starting Phase 4.
- IDOR protection ("a resident must not access another resident's data by
  modifying an ID") is architecturally committed to — every future
  resident-facing route will scope queries to `req.currentUser`'s own
  resident record, never trust a resident ID from the URL for a resident
  role — but there's nothing to test yet since no resident data routes
  exist until Phase 5.
- Password reset, account lockout after repeated failures, and rate
  limiting on `/api/auth/login` aren't in scope for this phase (spec's
  security section doesn't call these out explicitly; worth flagging for
  Phase 22, Security Hardening).
