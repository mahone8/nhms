# Common Mess — Phase 12

One shared mess across all five branches -- membership, menus, meal
attendance, expenses, and a cost report -- living in a financial ledger
that is structurally separate from resident hostel dues.

## Genuinely one common mess, not five

None of the mess tables (`mess_members`, `menus`, `meal_records`,
`mess_expenses` -- all built in Phase 1's migration 012) have a
`branch_id`. There's no per-branch mess to accidentally create, because
the schema doesn't have a column to attach one to. A resident from any
branch enrolls in the same single mess.

## What's new

`routes-pg/mess.js`, mounted at its own dedicated prefix (`/api/mess`) --
deliberately not nested under `/api/residents` and not sharing the bare
`/api` root, which is exactly what caused the router-interception bugs in
Phases 9 and 10. A dedicated prefix sidesteps that entire class of bug
rather than needing to remember a workaround each time.

| Route | Who | Purpose |
|---|---|---|
| `GET /members/me`, `GET /meal-records/me` | Resident | Their own membership and attendance history. |
| `GET /menus` | Anyone signed in | View the shared menu (residents included). |
| `POST /members`, `PATCH /members/:id/status`, `GET /members` | Admin/Super Admin | Enroll/deactivate mess members. |
| `POST /menus` | Admin/Super Admin | Set a day's menu (upserts -- posting the same date+meal again updates it). |
| `POST /meal-records`, `GET /meal-records` | Admin/Super Admin | Mark and browse attendance. |
| `POST /expenses`, `GET /expenses` | Admin/Super Admin | Groceries, utilities, and other mess spending. |
| `GET /report` | Admin/Super Admin | Total spend, meals served, cost per meal, and a per-member breakdown. |

## Mess finances stay separate from resident dues -- verified, not just claimed

Spec section 21: "Mess financial records must remain separate from
resident hostel dues." This holds because the mess tables have no
relationship to `charges` or `payments` at all -- there's no code path
anywhere in this file that writes to either. Tested directly: after
recording real mess expenses and meal attendance, queried the `charges`
table for anything resembling a mess-related description and got zero
rows.

## The cost report is computed from real recorded data

`GET /api/mess/report` computes `costPerMeal = totalExpenses / totalMeals`
over a date range, then reports each member's `mealsEaten` and an
`estimatedShare` (their meals times cost per meal) -- a standard,
defensible way to apportion shared mess costs, and explicitly labeled as
an estimate rather than a real charge (turning it into an actual charge,
if the hostel wants that, is a deliberate choice for whoever builds that
integration later -- this phase only reports).

## What I actually tested (against the live app and real Postgres)

- Enrolled two checked-in residents as mess members. Duplicate enrollment
  -> `409` with a friendly message (fixed a generic error along the way
  -- see below).
- Added a menu entry, then posted the same date+meal again with different
  items -> confirmed it updated the existing row (same `id`), not a
  duplicate.
- Resident role -> viewed the menu successfully (menus are visible to
  everyone signed in).
- Recorded meal attendance for both members across lunch and dinner.
  Attempting to record the same member+date+meal twice -> `409`.
- Resident viewed her own attendance history via `/meal-records/me`.
- Resident role -> record a mess expense -> `403`.
- Recorded 9,000 in expenses (6,000 groceries + 3,000 utilities), then
  pulled the report: `costPerMeal: 3000` (9,000 / 3 meals served), with
  Ayesha (2 meals) showing an estimated share of 6,000 and Fatima
  (1 meal) showing 3,000 -- checked by hand, matches exactly.
- Resident role -> the admin report -> `403`.
- Directly queried `charges` for anything mess-related afterward -> zero
  rows, confirming the separation is structural, not just documented.
- Found and fixed a small but real UX gap along the way:
  `lib/pgErrors.js`'s generic unique-violation handler didn't recognize
  the `mess_members` or `menus` constraints, so duplicate enrollment was
  returning the unhelpful fallback "That already exists." instead of a
  specific message. Added proper cases for both.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/mess/members -H "Content-Type: application/json" -d '{"residentId":5}'
curl -b admin.txt -X POST localhost:3001/api/mess/meal-records -H "Content-Type: application/json" \
  -d '{"messMemberId":1,"mealDate":"2026-09-05","mealType":"lunch"}'
curl -b admin.txt "localhost:3001/api/mess/report?from=2026-09-01&to=2026-09-30"
```

## What's next: Phase 13 -- Expenses

The general (non-mess) `expenses` table has existed since Phase 1 and
already supports per-branch or common (`branch_id: null`) spending across
categories like electricity, salaries, and maintenance. This phase adds
the routes to actually record and browse it, following the exact same
pattern as this phase's mess expenses -- just without a mess-specific
angle.

Phases remaining after that (12 total): Branch revenue/financial analysis
(14), Dashboard (15), Reports (16), Global Search (17), Notices/
Notifications (18), Resident Portal UI (19), Audit Logs UI (20), System
Settings (21), Security hardening (22), Performance optimization (23),
Complete QA (24), Vercel production deployment verification (25).
