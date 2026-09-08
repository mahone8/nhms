# Notices / Notifications — Phase 18

Two related but genuinely different features, kept in two tables (both
built in Phase 1) and two route files: broadcast-style notices with a
title/message/target, and per-user notifications with a read/unread
state. Trying to force payment reminders into the notices system would
have meant bolting read-tracking onto something not built for it --
using `notifications` for that instead was the correct fit from the
start.

## What's new

`routes-pg/notices.js` (mounted `/api/notices`):
- `GET /me` (resident) -- general notices, their branch's, and ones aimed
  specifically at them; active and not expired.
- `GET /`, `POST /`, `PATCH /:id/status` (Admin/Super Admin) -- compose,
  list/filter, and change status.

`routes-pg/notifications.js` (mounted `/api/notifications`):
- `GET /me`, `PATCH /me/:id/read` (resident) -- their own feed.
- `POST /generate-payment-reminders` (Admin/Super Admin) -- scans active
  residents' dues (reusing Phase 9's `computeDues`) and creates a
  `payment_reminder` notification for anyone `due` or `overdue`, skipping
  anyone who already has one unread.

## Residents see exactly what the spec lists -- verified with two residents in two branches

Set up one resident in Nazzal and one in Nooroxotel, then created three
notices: one `all`, one targeted at Nazzal only, one targeted
specifically at the Nooroxotel resident. Confirmed:
- The Nazzal resident saw the general notice and the Nazzal one -- not
  the other resident's personal notice.
- The Nooroxotel resident saw the general notice and her own personal one
  -- not the Nazzal-only one.

Same pattern as Phase 17's search: the scoping is a JOIN/WHERE against
the caller's own resident_id and branch_id, not a filter applied to an
already-broader query.

## Expiry is enforced, not just displayed

A notice with an expiry date in the past never appears in
`GET /notices/me` -- verified by creating one dated `2020-01-01` and
confirming it was excluded from a resident's feed immediately, without
needing any separate "expire old notices" job to run first.

## The payment reminder dedup rule

Running `POST /generate-payment-reminders` a second time in a row while
the first reminder is still unread creates zero new notifications for
anyone who already has one pending -- verified directly: the first run
created 2 reminders (both test residents had unpaid check-in charges),
the second run immediately after created 0.

## IDOR protection on marking notifications read

`PATCH /me/:id/read` checks `WHERE id = $1 AND user_id = $2` -- both
conditions, not just the notification's own id. Verified directly: had
one resident attempt to mark another resident's notification as read by
guessing its ID -- got `404` (not confirming the notification even
exists), and confirmed the target notification's `is_read` flag was
genuinely untouched afterward, not just that the response looked right.

## What I actually tested (against the live app and real Postgres)

- Created `all`, `branch`, and `resident`-targeted notices; an invalid
  combination (`branch` type with no `targetBranchId`) -> clean `400`.
- Two residents in two branches each saw exactly the notices meant for
  them, confirmed by name in both directions.
- Resident role -> create a notice -> `403`.
- An expired notice was correctly excluded from a resident's feed.
- Payment reminder generation created reminders for both active
  (unpaid) residents on the first run, then created zero duplicates on
  an immediate second run.
- One resident attempting to mark another's notification as read -> `404`,
  and the target notification's read state was verified unchanged
  afterward.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/notices -H "Content-Type: application/json" \
  -d '{"title":"Water outage","message":"2-4pm today","targetType":"all"}'

curl -b admin.txt -X POST localhost:3001/api/notifications/generate-payment-reminders

curl -b resident.txt localhost:3001/api/notices/me
curl -b resident.txt localhost:3001/api/notifications/me
```

## What's next: Phase 19 -- Resident Portal (UI)

The first actual frontend built against this Postgres/Vercel app since
Phase 2 -- everything up to this point has been API-only. This phase
wires together the resident-facing endpoints already built (`/me` routes
across residents, payments, dues, mess, notices, notifications) into an
actual set of pages a resident can log into and use.

Phases remaining after that (6 total): Audit Logs UI (20), System
Settings (21), Security hardening (22), Performance optimization (23),
Complete QA (24), Vercel production deployment verification (25).
