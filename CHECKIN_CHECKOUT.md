# Check-in / Check-out — Phase 7

The two transactions everything else in the system ultimately hangs off
of. This is where a `confirmed` admission actually becomes a living-in
resident, and where a resident's stay actually ends.

## Check-in — one transaction, six effects

Given a confirmed admission, `POST /api/check-in` does all of this
atomically, per spec section 13 ("The final check-in operation must be
transactional"):

1. Creates the `residents` row — `status = 'active'`, with the branch,
   room, and bed from the admission.
2. Flips the held bed from `reserved` to `occupied`.
3. Opens the first `resident_assignments` row (`reason: 'check_in'`,
   `end_date: NULL`).
4. Generates three `charges`: registration fee, security fee, and the
   first month's rent — using the exact amounts recorded during
   admissions and the room's actual `monthly_rent`.
5. Marks the admission `converted`, linked to the new resident.
6. Optionally creates and links a resident login account, if
   `username`/`password` were provided ("Resident account is activated if
   applicable").

## The race-condition protection, twice over

Phase 6 already protected bed *selection* with `SELECT ... FOR UPDATE`.
Check-in adds a second, independent check: it re-verifies the bed is
*still* `reserved` right before committing, inside the same transaction.
This matters because time can pass between confirming an admission and
actually checking someone in — someone could have manually intervened on
the bed in between. Tested directly: manually freed a confirmed
admission's held bed from outside the app, then attempted check-in — got
a clean `409` instead of silently creating an inconsistent double-booking.

## Check-out — closes the stay, touches nothing else

`POST /api/check-out` closes the resident's current stay: the open
`resident_assignments` row gets an `end_date` (never deleted, never
rewritten), the bed goes back to `available`, and the resident becomes
`checked_out` with `room_id`/`bed_id` cleared — but `branch_id` and every
charge/payment record are left completely untouched, exactly as spec
section 14 requires ("Do not delete the resident's historical records").

`GET /api/residents/:id/checkout-preview` surfaces the numbers section 14
asks to show before checking someone out — rent charged, other charges,
security fee on file, total outstanding, and a suggested possible refund.
This is read-only and clearly labeled as a suggestion: actually recording
a final payment or refund is Payments/Receipts (Phase 10), which doesn't
exist yet, so this phase doesn't pretend to settle anything automatically.

## What I actually tested (against the live app and real Postgres)

- Ran the full Phase 6 pipeline to get a confirmed admission, then checked
  it in. Verified **every** side effect landed correctly by querying the
  database directly afterward: bed → `occupied`, a `resident_assignments`
  row with the right rent/dates/reason, all three charges at the right
  amounts, the admission → `converted` and linked to the new resident, and
  the resident's login account created.
- Tried to check in the same (now-converted) admission again → rejected.
- Tried to check in an admission still sitting at `inquiry` → rejected.
- Resident role → check-in → `403`.
- Fetched the checkout preview for the freshly checked-in resident — the
  arithmetic matched by hand: `52,000` total charged, `0` paid,
  `52,000` outstanding, `15,000` security on file → `0` possible refund,
  `37,000` still owed beyond the deposit.
- Tried a checkout date before the stay's start date → rejected.
- Checked the resident out — then verified directly in the database that
  the bed was freed, the assignment row was *closed* (not deleted, has
  both start and end dates), all three charges were completely untouched,
  and the resident row still exists with `branch_id` intact for history.
- Tried to check the same resident out a second time → rejected (no open
  stay to close).
- **Race-condition test:** set up a confirmed admission, then manually
  freed its held bed directly in the database (simulating an
  inconsistency), then attempted check-in → correctly caught and rejected
  with `409` instead of creating a broken double-booking.
- Cleaned up all test data, re-ran Phase 2's JWT suite and the legacy app
  — both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/check-in -H "Content-Type: application/json" \
  -d '{"admissionId":5,"username":"ayesha1","password":"Passw0rd!"}'

curl -b admin.txt localhost:3001/api/residents/5/checkout-preview

curl -b admin.txt -X POST localhost:3001/api/check-out -H "Content-Type: application/json" \
  -d '{"residentId":5,"checkoutDate":"2026-09-10"}'
```

## What's next: Phase 8 — Transfers / Stay history

Transfer (spec section 15) moves an active resident to a different
branch/room/bed without ever touching their check-in date or financial
history: validate the destination, verify the new bed is actually
available (same race-condition discipline as check-in), close the current
`resident_assignments` row, open a new one (`reason: 'transfer'`), release
the old bed, occupy the new one, and update the resident's current
location — all in one transaction. Stay history itself (section 16) is
already fully built as of Phase 1 (`resident_assignments`); Phase 8 is
really about exposing it properly (a per-resident timeline endpoint) and
building transfer on top of it.

Phases remaining after that (17 total): Rent/Charges (9), Payments/
Receipts (10), Automatic monthly rent (11), Common Mess (12), Expenses
(13), Branch revenue/financial analysis (14), Dashboard (15), Reports
(16), Global Search (17), Notices/Notifications (18), Resident Portal UI
(19), Audit Logs UI (20), System Settings (21), Security hardening (22),
Performance optimization (23), Complete QA (24), Vercel production
deployment verification (25).
