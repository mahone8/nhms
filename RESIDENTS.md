# Residents — Phase 5

Resident profile management: creating, viewing, searching, and editing
resident records, plus linking a resident to their own login account. This
is deliberately **not** the admission or check-in workflow (Phases 6–7) —
a resident created here has no bed yet and sits in `status = 'reserved'`
until check-in assigns one.

## Why residents don't get a bed here

`residents.branch_id` is required, but `room_id`/`bed_id` are left `NULL`
at creation. Assigning a bed is check-in's job (Phase 7) — it's the thing
that gives `status = 'active'` meaning (a resident who is "active" but has
no bed would be a data inconsistency later reports and dashboards would
have to work around). So `PATCH /:id/status` here only allows toggling
between `reserved` and `suspended` — the same pattern as Phase 4's beds
route deliberately excluding `occupied`.

## The IDOR protection the spec calls for in section 9

`GET /api/residents/me` never reads a resident ID from the request at
all — it looks up `WHERE residents.user_id = req.currentUser.id`, and
`req.currentUser` comes from the verified session (Phase 3's `lib/rbac.js`),
never from anything the client sent. A resident has no route in this file
that accepts an `:id` parameter — `GET /:id`, `PATCH /:id`, etc. are all
behind `requireRole("admin", "super_admin")`, so there is no URL a
resident could edit to reach another resident's record; the role check
fails before the ID is ever looked at.

## Linking a login account

A resident can be created with `username`/`password` up front (in one
transaction with the resident record itself), or without one and linked
later via `PATCH /:id/account`. Both paths go through the same `users`
table and `bcrypt` hashing from Phase 3 — there's no separate, weaker
auth path for residents.

## What I actually tested (against the live app and real Postgres)

- Created a resident with a linked login in one request — response showed
  `status: "reserved"`, `roomId`/`bedId` both `null`, and the resident's
  `username` — all as a single atomic transaction.
- Duplicate username at creation → clean `409`, no partial resident record
  left behind (the transaction rolled back).
- Created a second resident with *no* login, then linked one afterward via
  `PATCH /:id/account`, then logged in with those exact credentials and
  confirmed it worked.
- **IDOR test:** logged in as the first resident (Ayesha) and confirmed
  `GET /api/residents/me` returns only her own record. Then had her
  attempt `GET /api/residents` (list everyone) → `403`, and
  `GET /api/residents/4` (the second resident's ID, guessed directly) →
  `403` — the role check blocks it before the ID is ever considered.
- Attempted to set a resident's status directly to `active` → rejected
  with a message pointing at check-in. Setting it to `suspended` (allowed)
  worked correctly.
- Edited profile fields (`phone`, `program`) via `PATCH /:id` and
  confirmed only those fields changed, everything else untouched.
- Searched/filtered as Admin by branch name and partial name match —
  both worked correctly against real data.
- Cleaned up test data, re-ran Phase 2's `test:jwt` suite (still passing),
  and confirmed the legacy SQLite app still works untouched.
- Also hit, and left alone on purpose: attempting to hard-delete a test
  user who by then had audit history correctly failed with the Phase 3 FK
  protection — deactivating it instead worked, exactly as designed.

## Trying it yourself

```bash
curl -b admin_cookies.txt -X POST localhost:3001/api/residents \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Ayesha Malik","branchId":1,"joiningDate":"2026-09-01","username":"ayesha1","password":"Passw0rd!"}'

curl -b admin_cookies.txt localhost:3001/api/residents?branch=Nazzal
```

## What's next: Phase 6 — Admissions

The pipeline described in spec section 12 (Inquiry → Registration →
Verification → Select Branch → Available Rooms/Beds → Select Bed →
Registration Fee → Security Fee → Confirmation → Check-in), backed by the
`admissions` table already built in Phase 1. This is what will sit in
front of resident creation for the normal "someone walks in wanting a
room" flow, culminating in Phase 7's check-in actually assigning a bed and
flipping status to `active`.

Phases remaining after that: Check-in/Check-out (7), Transfers/Stay
history (8), Rent/Charges (9), Payments/Receipts (10), Automatic monthly
rent (11), Common Mess (12), Expenses (13), Branch revenue/financial
analysis (14), Dashboard (15), Reports (16), Global Search (17),
Notices/Notifications (18), Resident Portal UI (19), Audit Logs UI (20),
System Settings (21), Security hardening (22), Performance optimization
(23), Complete QA (24), Vercel production deployment verification (25).
