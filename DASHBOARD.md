# Dashboard — Phase 15

The main Admin/Super Admin landing page's data, in one call. Almost
entirely composition of what already exists -- this phase adds very
little new logic of its own, on purpose.

## What's new

`routes-pg/dashboard.js` -- a single `GET /api/dashboard` returning
exactly spec section 24's field list:

- Company-wide: total branches, total/occupied/available/reserved beds,
  occupancy %, active residents, rent collection, registration fees,
  security fees, other revenue, total revenue, outstanding dues,
  expenses, net income.
- `branchCards`: the same breakdown per branch (total/occupied/available/
  reserved beds, occupancy %, revenue, expenses).

## Built entirely on Phase 4 and Phase 14 -- nothing new to get wrong

The bed-status counting is the exact same query shape already used by
`GET /api/branches` (Phase 4). The revenue/expenses/outstanding figures
come directly from `computeBranchEarnings` (Phase 14) -- summed across
branches for the company-wide numbers, used as-is for each branch card.
There's no second, dashboard-specific implementation of "how do we
calculate revenue" for these numbers to quietly drift out of sync with
what `GET /api/branches/:id/earnings` reports -- it's the same function
call.

## What I actually tested (against the live app and real Postgres)

- Fresh database: `totalBranches: 5`, `totalBeds: 180`, everything else
  correctly zero, 5 branch cards all zeroed out.
- Resident role -> `403`.
- Checked in one resident each into two different branches (Nazzal and
  Nooroxotel), recorded payments (52,000 and 30,000) and expenses (4,000
  and 2,000) against each, then pulled the dashboard:
  - `occupiedBeds: 2` out of `180` -> `occupancyPercent: 1.11` (checked
    by hand: 2/180 = 1.111...%).
  - `totalRevenue: 82000` (52,000 + 30,000), `expenses: 6000` (4,000 +
    2,000), `netIncome: 76000` -- all correct sums across the two active
    branches.
  - `outstandingDues: 22000` -- Nazzal's resident was paid in full (0
    outstanding), Nooroxotel's had 22,000 still owed (52,000 charged -
    30,000 paid) -- the company-wide figure correctly summed both.
  - The three untouched branches (Ayesha, Aqsa, Velvet Rose) each showed
    `occupied: 0`, `revenue: 0`, `expenses: 0` in their cards, exactly as
    expected.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt localhost:3001/api/dashboard
```

## What's next: Phase 16 -- Reports

Spec's reports are largely re-slicing data that already exists across
Phases 5-15 (occupancy over time, revenue by category, resident
turnover, etc.) into specific report views -- the underlying queries are
mostly variations on what `lib/earnings.js`, `lib/dues.js`, and the
existing list/filter endpoints already do.

Phases remaining after that (9 total): Global Search (17), Notices/
Notifications (18), Resident Portal UI (19), Audit Logs UI (20), System
Settings (21), Security hardening (22), Performance optimization (23),
Complete QA (24), Vercel production deployment verification (25).
