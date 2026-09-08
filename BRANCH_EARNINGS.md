# Branch Revenue / Financial Analysis — Phase 14

A reporting layer over Phases 9-13 -- no new tables. Just the one formula
spec section 23 is very explicit about, computed correctly.

## The formula, and the mistake it explicitly warns against

> Total Revenue = Actual collected rent + registration + security + other
> revenue
> Net Income = Total Revenue - Branch Expenses
> Revenue must be based on actual payments collected, not charges
> generated.
>
> Example: Charges = 1,000,000, Payments collected = 850,000. Then
> Revenue = 850,000, Outstanding = 150,000. Do not incorrectly treat the
> 1,000,000 charge total as revenue.

`lib/earnings.js` (`computeBranchEarnings`) only ever sums the `payments`
table for the revenue figures -- `charges` is only used for the
`outstandingDues` figure, never folded into revenue. This was verified
with the spec's own scenario, scaled down: a resident charged 52,000
total (registration + security + first month's rent) who had only paid
25,000 showed `totalRevenue: 25000`, not 52,000.

## What's new

Added to `routes-pg/branches.js` (not a new file -- this is squarely a
branch-resource concern):

- `GET /api/branches/earnings` -- every branch's figures at once.
- `GET /api/branches/:id/earnings` -- one branch's detail.

Both registered before the existing `GET /:id` route in the file --
`earnings` as a literal path segment would otherwise be swallowed by
`:id` matching it as a parameter value (the third time this exact
ordering trap has come up, after Phases 9 and 10 -- this time caught and
avoided within a single file before it ever became a bug, by writing the
test for it upfront).

## Two things worth being precise about

**Refunds reduce revenue, but not outstanding dues.** A `refund` payment
is money going back out to a resident -- it's subtracted from
`totalRevenue` and `netIncome` (verified: a 2,000 refund dropped revenue
from 25,000 to 23,000). But it does not reduce `outstandingDues` --
issuing a refund doesn't retroactively un-charge someone, so outstanding
is computed from gross collected (before refunds), not net.

**"Branch Expenses" means this branch's own expenses, not a share of
Common/All-Branches ones.** The spec's formula says "Total Revenue -
Branch Expenses," which only makes sense in a per-branch context if it
means expenses actually recorded against that branch_id -- Common
expenses (branch_id IS NULL) aren't divided across branches here, since
the spec doesn't define how that split should work, and guessing a
policy wasn't asked for.

## What I actually tested (against the live app and real Postgres)

- `GET /api/branches/earnings` on a fresh database returned all 5
  branches, correctly all zeros, and confirmed it wasn't swallowed by the
  `:id` route (which would have returned a type error trying to compare
  a branch ID column to the literal string "earnings").
- Checked in a resident (charges: 52,000 total), then paid only 20,000 of
  the rent and the 5,000 registration fee (25,000 total). Earnings showed
  `totalRevenue: 25000` -- matching the spec's own worked example
  principle exactly, not the 52,000 charged.
- `netIncome` correctly subtracted a recorded 3,000 branch expense:
  25,000 - 3,000 = 22,000.
- `outstandingDues` correctly showed 27,000 (52,000 charged - 25,000
  collected).
- Recorded a 2,000 refund: revenue dropped to 23,000, net income to
  20,000, and outstanding dues stayed at 27,000, confirming refunds don't
  affect what's still owed.
- Resident role -> both earnings routes -> `403`.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt localhost:3001/api/branches/earnings
curl -b admin.txt localhost:3001/api/branches/1/earnings
```

## What's next: Phase 15 -- Dashboard

The main Admin/Super Admin landing page's data: total branches, total
beds/occupancy, resident counts, today's check-ins/check-outs, overdue
payments, and a company-wide rollup of this phase's per-branch earnings.
Almost entirely a matter of composing queries and helpers that already
exist (`computeBranchEarnings`, the occupancy counts already in
`GET /api/branches`) into one summary endpoint.

Phases remaining after that (10 total): Reports (16), Global Search (17),
Notices/Notifications (18), Resident Portal UI (19), Audit Logs UI (20),
System Settings (21), Security hardening (22), Performance optimization
(23), Complete QA (24), Vercel production deployment verification (25).
