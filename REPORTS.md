# Reports — Phase 16

The largest single spec section so far, mostly satisfied by re-slicing
data that already exists across Phases 5-15 -- five flexible endpoints
rather than the dozen-plus separate routes a literal reading of the
category list might suggest.

## What's new

`routes-pg/reports.js`, mounted at `/api/reports`, all Admin/Super Admin:

| Route | Covers |
|---|---|
| `GET /residents` | Current/active/checked-out/suspended (`status` filter), new admissions (`from`/`to` on joining date), branch/university/department-wise (`groupBy`). |
| `GET /rooms` | 1/2/3/4 Seater, Attached/Common Bath, available/occupied/reserved -- all as bed-level filters or `groupBy`. |
| `GET /occupancy` | Per-branch total beds, available capacity, occupancy % -- a live snapshot. |
| `GET /financial` | Every field section 25 lists, for a date range and branch (or all), plus daily/monthly collection via `groupBy=day` or `month`. |
| `GET /mess` | Members, meals, expenses, statistics -- reuses Phase 12's exact calculation. |

Every route accepts `?format=csv` for a downloadable file instead of
JSON.

## One flexible endpoint instead of eight

Spec lists "Current residents / Active residents / New admissions /
Checked-out / Suspended / Branch-wise / University-wise / Department-wise"
as eight separate resident report categories. Building eight routes for
what is really one filtered-and-optionally-grouped query would be
needless duplication -- `GET /residents` covers all eight through
`status`, `from`/`to`, and `groupBy` parameters. The same pattern applies
to room reports (`groupBy=roomType|bathroomType|status`).

## Why occupancy reports don't take a date range

Financial reports meaningfully support a date range because `payments`
and `expenses` are historical, timestamped records. Occupancy doesn't
have an equivalent -- there's no periodic snapshot table recording "what
occupancy looked like on day X," only the current state of `beds.status`.
Reporting a fabricated historical trend from data that doesn't exist
would be worse than not reporting it; this deliberately reports live
occupancy only.

## PDF and Excel export are deliberately not built yet

Spec section 25 asks for PDF and Excel/CSV export. CSV is built -- it's
essentially free (a few dozen lines in `lib/csv.js`, no new dependency).
PDF and Excel are a different proposition: both need a real library
(a PDF renderer, exceljs or similar) and, more importantly, there's no
frontend anywhere in the Postgres app yet for a person to click "export"
from -- building file-generation infrastructure with nothing to trigger
it is exactly the over-engineering the spec's own section 52 warns
against. Worth building once the reports UI exists.

## A real formatting bug this phase caught

CSV rows for anything with a DATE column (like `joining_date`) were
rendering as `Sat Sep 05 2026 00:00:00 GMT+0000 (Coordinated Universal
Time)` -- node-pg returns DATE columns as JavaScript Date objects, and
the CSV converter's naive `String(val)` used `Date.prototype.toString()`.
Fixed in `lib/csv.js` by special-casing Date instances to
`toISOString().slice(0, 10)` instead, giving a clean `2026-09-05`.

## What I actually tested (against the live app and real Postgres)

- Confirmed the Phase 12 mess report refactor (extracting its logic into
  `lib/messReport.js` so this phase could reuse it) didn't break the
  original `/api/mess/report` route.
- Room report grouped by type on the fresh seed data: `4 Seater: 120`,
  `3 Seater: 60` beds -- matches the known 6:4 room-type ratio across 5
  branches exactly.
- Resident role -> all five report routes -> `403`.
- Checked in three residents across two branches and two universities.
  `groupBy=university` -> `NFC IEFR: 2, COMSATS: 1`.
  `groupBy=branch` -> `Nazzal: 2, Nooroxotel: 1`. Both correct.
  Combined university + department filter -> exactly the 2 matching
  residents.
- Recorded two rent payments in September, requested
  `financial?groupBy=month` -> correctly bucketed both into one
  `2026-09-01` period totaling `25000`.
- Found and fixed the date-formatting bug above -- verified CSV output
  now shows `2026-09-05`, not a verbose timestamp string, and confirmed
  the `Content-Type: text/csv` and `Content-Disposition: attachment`
  headers are both set correctly for a real download.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt "localhost:3001/api/reports/residents?groupBy=university"
curl -b admin.txt "localhost:3001/api/reports/financial?branch=Nazzal&groupBy=month&from=2026-09-01&to=2026-09-30"
curl -b admin.txt "localhost:3001/api/reports/residents?format=csv" -o residents.csv
```

## What's next: Phase 17 -- Global Search

A single search box that can find a resident, an admission, or a
payment/receipt by name, CNIC, phone, or receipt number -- scoped so an
Admin only ever sees results they'd already be allowed to see through the
normal routes.

Phases remaining after that (8 total): Notices/Notifications (18),
Resident Portal UI (19), Audit Logs UI (20), System Settings (21),
Security hardening (22), Performance optimization (23), Complete QA (24),
Vercel production deployment verification (25).
