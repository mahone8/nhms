# Branches / Rooms / Beds — Phase 4

The first real feature routes on top of Phases 1–3: managing the physical
structure of the hostel — branches, rooms, and beds — through the API,
with all the database-level guarantees from Phase 1 now reachable (and
verified) through real HTTP requests.

## Permission split

| Action | Admin | Super Admin |
|---|:---:|:---:|
| View branches, rooms, beds | ✓ | ✓ |
| Create/edit rooms and beds, change their status | ✓ | ✓ |
| Create/edit a branch, activate/deactivate it | ✗ | ✓ |

This follows the spec precisely: section 7 lists "Manage rooms" and
"Manage beds" directly under Admin's capabilities, but section 6's branch
list ("Create branches... Activate/deactivate branches...") has no Admin
counterpart in section 7. Permissions are allow-listed per role in
`routes-pg/*.js` — nothing is inferred or assumed.

## What's new

| File | Purpose |
|---|---|
| `routes-pg/branches.js` | List (with live occupancy stats), view, create/edit/activate/deactivate (Super Admin only for the last three). |
| `routes-pg/rooms.js` | List per branch, view, create/edit, change status (active/inactive/maintenance). Admin and Super Admin both. |
| `routes-pg/beds.js` | List per room or per branch (the latter is a bed-grid-ready view with room details joined in), create, change status. |
| `lib/pgErrors.js` | Translates raw Postgres errors (unique violations, the capacity triggers from Phase 1, etc.) into clean JSON instead of a generic 500 — see below. |

## A deliberate restriction: bed status can't be set to "occupied" here

`PATCH /api/beds/:id/status` only accepts `available` or `reserved`.
Setting a bed to `occupied` is left entirely to the check-in workflow
(Phase 7), because occupancy only makes sense alongside a
`resident_assignments` row recording *who* and *since when*. Letting this
endpoint set `occupied` directly would let someone mark a bed occupied
with nobody actually assigned to it — tested and confirmed rejected with a
clear error pointing at check-in as the correct path.

## Business rules enforced at the database, exposed cleanly at the API

Phase 1 put capacity limits, auto-derived room capacity, and branch/bed
consistency into database triggers and constraints — not application code.
This phase is the first time those get exercised through real HTTP calls,
and it needed one new piece: `lib/pgErrors.js`, which turns a raw trigger
exception like `Room 52 is already at its capacity of 2 beds` (Postgres
error code `P0001`) or a unique-constraint violation (code `23505`) into
the right HTTP status and a clean JSON error, instead of a generic 500.
The business rule itself still lives in exactly one place — the database —
this is purely a translation layer.

## What I actually tested (against the live app and real Postgres)

- Listed branches as Admin — got real per-branch occupancy counts
  (`total_beds`, `occupied_beds`, `available_beds`, `reserved_beds`)
  computed live from the `beds` table, not stored/stale numbers.
- Resident role → `GET /api/branches` → **403** (residents have no
  business here at all).
- Admin → `POST /api/branches` (create one) → **403**. Super Admin → same
  request → **201**, proving branches genuinely aren't hardcoded to the
  original five — a sixth branch was created, used, and torn down entirely
  through the API.
- Created a room with `roomType: "2 Seater"` and confirmed the response's
  `capacity` came back as `2` — never sent by the client, derived entirely
  by the Phase 1 trigger.
- Sent an invalid `roomType` (`"5 Seater"`) → clean `400` with a helpful
  message, not a raw constraint error.
- Added 2 beds to that 2-seater room (succeeded), then tried a 3rd → the
  Phase 1 capacity trigger fired, and `lib/pgErrors.js` turned it into a
  clean `409: "Room 52 is already at its capacity of 2 beds"`.
- Tried adding a duplicate bed number in the same room → clean `409` from
  the unique constraint, not a 500.
- Fetched beds by branch and confirmed each bed's `branch_id` matched the
  new branch automatically — the Phase 1 branch-sync trigger, now proven
  reachable through the bed-creation API, not just direct SQL.
- Resident role → room/bed management routes → **403** across the board.
- Attempted to `PATCH` a bed's status to `occupied` → rejected with the
  explicit message pointing at check-in.
- Cleaned up all test data, re-ran Phase 2's `test:jwt` suite (still
  passing) and started the legacy SQLite app (still working, untouched).

## Not yet done (upcoming phases)

- Residents (Phase 5) — nothing about `residents` exists in the new app
  yet; today's "occupied" bed count will always read 0 until then.
- Admissions and Check-in/Check-out (Phases 6–7) — this is what will
  actually be allowed to set a bed to `occupied`.
- No `DELETE` endpoints for branches/rooms/beds exist, on purpose — the
  spec only calls for status changes (active/inactive/maintenance,
  available/occupied/reserved), and once residents and stay history exist,
  hard-deleting a room or bed would orphan historical data.
