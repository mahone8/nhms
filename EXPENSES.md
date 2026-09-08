# Expenses — Phase 13

The general (non-mess) `expenses` table has existed since Phase 1 with
every field spec section 22 lists (branch/common designation, category,
amount, date, description, recorded by, created at) and the exact
category list as a database CHECK constraint. This phase is genuinely
small: it's just the routes to record and browse it.

## What's new

`routes-pg/expenses.js`, mounted at its own prefix (`/api/expenses`):

- `POST /` -- record an expense, either branch-specific (`branchId`
  provided) or Common/All Branches (omitted).
- `GET /`, `GET /:id` -- browse and filter by branch (or specifically
  `branch=common`), category, and date range.

Admin/Super Admin only -- this is purely a bookkeeping tool, not
something residents have any reason to see.

## The one thing worth calling out: explicit branch validation

A `branchId` of null/omitted means Common/All Branches by design (the
column is nullable exactly for this). But a garbage `branchId` (one that
doesn't correspond to a real branch) is a data-entry mistake, not a
common expense -- so it's validated explicitly and rejected with `400`
rather than silently accepted or silently falling back to common.

## What I actually tested (against the live app and real Postgres)

- Recorded a branch-specific expense (electricity, Nazzal) and a common
  one (salaries, no branch) -- both stored correctly, `branch_id: null`
  for the common one.
- Invalid category and negative amount both rejected with clean `400`s.
- A `branchId` that doesn't exist -> `400`, not silently treated as
  common.
- Resident role -> both listing and recording -> `403`.
- Filtered by `branch=common` -> only the salaries expense. Filtered by
  `branch=Nazzal` -> only the electricity expense. Both correct.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/expenses -H "Content-Type: application/json" \
  -d '{"branchId":1,"category":"electricity","amount":15000,"description":"August bill"}'

curl -b admin.txt "localhost:3001/api/expenses?branch=common"
```

## What's next: Phase 14 -- Branch Revenue / Financial Analysis

Spec section 23 asks, per branch: rent collected, registration fees
collected, security fees collected, other revenue, total revenue,
expenses, and (implicitly) net -- all of which can now be computed
entirely from data that already exists (`payments` for revenue,
`expenses` for costs, both filterable by `branch_id`). No new tables
needed; this phase is a reporting layer over Phases 9-13.

Phases remaining after that (11 total): Dashboard (15), Reports (16),
Global Search (17), Notices/Notifications (18), Resident Portal UI (19),
Audit Logs UI (20), System Settings (21), Security hardening (22),
Performance optimization (23), Complete QA (24), Vercel production
deployment verification (25).
