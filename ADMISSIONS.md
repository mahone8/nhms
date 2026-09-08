# Admissions — Phase 6

The pipeline from spec section 12: Inquiry → Registration → Verification →
Select Branch → Available Rooms/Beds → Select Bed → Registration Fee →
Security Fee → Confirmation. This phase covers everything up through
Confirmation. Check-in itself — the step that actually creates the
resident's active stay, permanently occupies the bed, and generates
charges — is Phase 7, and is the only thing allowed to set an admission's
status to `converted`.

## What's new

`routes-pg/admissions.js`, all Admin/Super Admin (residents have no
business in this workflow at all — tested, `403`):

| Route | Purpose |
|---|---|
| `POST /` | Step 1: Inquiry. |
| `PATCH /:id/status` | Advance the pipeline (`inquiry→registration→verification→confirmed`) or cancel from any open stage. Enforced as an explicit transition map — no skipping stages, no moving backward. |
| `PATCH /:id/branch` | Step 4: Select Branch. |
| `GET /:id/available-beds` | Step 5: only ever returns beds that are genuinely `available` right now. |
| `PATCH /:id/bed` | Step 6: Select Bed — places a *hold* (bed → `reserved`), doesn't occupy it. |
| `PATCH /:id` | Edit contact fields, and set Registration Fee / Security Fee. |

## Why selecting a bed only reserves it, and why that matters

A bed going to `occupied` should mean "a resident is actually, currently,
living here" — that's what Phase 4 deliberately protected by refusing to
let anything set that status directly. Selecting a bed during admissions
is provisional: paperwork might fall through, fees might not get paid,
the applicant might change their mind about the branch. So this phase
uses the bed's third status, `reserved`, exactly as Phase 1 intended it —
a hold, not an occupancy.

## The race condition the spec explicitly calls out

Section 12: *"Backend must re-check availability immediately before final
admission/check-in."* `PATCH /:id/bed` re-reads the bed's status **inside
the transaction**, with `SELECT ... FOR UPDATE` — which means if two
admissions try to grab the same bed at nearly the same moment, the second
one's transaction blocks until the first commits, then sees the bed is no
longer `available` and is rejected with a clear `409`. This isn't
theoretical — see "What I tested" below, it's exactly what happened.

## A bug this phase's own testing caught

My first pass let a `confirmed` admission still have its branch or fees
changed via `PATCH /:id` and `PATCH /:id/branch` — only `converted` and
`cancelled` were locked. That's wrong: once confirmed, changing the
branch silently released the held bed and left the admission in a
half-consistent state (branch changed, bed cleared, still marked
"confirmed"). Fixed by locking edits at `confirmed` as well — the only
thing a confirmed admission can still do is move to `cancelled` (Phase 7
check-in will be the other exit). Re-tested and confirmed both edit routes
now correctly return `409` once confirmed.

## What I actually tested (against the live app and real Postgres)

- Created an inquiry; resident role → any admissions route → `403`.
- Tried to jump straight from `inquiry` to `confirmed` → rejected, told
  exactly which transitions are allowed from here.
- Advanced through `registration` → `verification` normally.
- Selected a branch, listed available beds (all 36, since nothing occupies
  the fresh branch yet), selected one — bed's status flipped to
  `reserved`, confirmed via the beds API from Phase 4.
- **Race condition test:** with bed 1 already held by admission #1, had a
  second admission try to select the exact same bed → `409: "That bed is
  no longer available -- someone else may have just selected it."`
- Tried to confirm before fees were set → rejected, named exactly what was
  missing (`registration fee, security fee`).
- Set fees, confirmed successfully.
- **Found and fixed the bug above** — verified both branch-change and
  fee-edit attempts on a confirmed admission now correctly return `409`.
- Cancelled a confirmed admission → its held bed correctly went back to
  `available`.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app —
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/admissions -H "Content-Type: application/json" -d '{"fullName":"Zara Khan"}'
curl -b admin.txt -X PATCH localhost:3001/api/admissions/1/status -d '{"status":"registration"}' -H "Content-Type: application/json"
curl -b admin.txt -X PATCH localhost:3001/api/admissions/1/branch -d '{"branchId":1}' -H "Content-Type: application/json"
curl -b admin.txt localhost:3001/api/admissions/1/available-beds
```

## What's next: Phase 7 — Check-in / Check-out

Check-in will be the transaction that actually matters most in the whole
system: given a `confirmed` admission, it creates the `residents` row (or
links to one already created in Phase 5), sets `status = 'active'`,
assigns `room_id`/`bed_id` for real, flips the bed to `occupied`, opens
the first `resident_assignments` row (`reason = 'check_in'`), generates
the registration fee, security fee, and first month's rent as `charges`,
and marks the admission `converted`. Check-out is the mirror image:
closes the assignment, frees the bed, generates any final charges.

Phases remaining after that (18 total): Transfers/Stay history (8),
Rent/Charges (9), Payments/Receipts (10), Automatic monthly rent (11),
Common Mess (12), Expenses (13), Branch revenue/financial analysis (14),
Dashboard (15), Reports (16), Global Search (17), Notices/Notifications
(18), Resident Portal UI (19), Audit Logs UI (20), System Settings (21),
Security hardening (22), Performance optimization (23), Complete QA (24),
Vercel production deployment verification (25).
