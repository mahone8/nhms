# Automatic Monthly Rent — Phase 11

One job, two ways to trigger it -- because this app now has two real
deployment targets: Vercel (serverless, needs an HTTP-triggered cron) and
a CWP VPS (a normal always-on server, where native crontab is simpler and
more standard than an HTTP round-trip to itself).

## One core function, two thin entry points

`jobs/generate-monthly-rent.js` holds all the actual logic and is the
only place it's written. It's used two ways:

1. CLI script, for a CWP (or any) native cron job:
   `node jobs/generate-monthly-rent.js`
2. HTTP endpoint, for Vercel Cron: `GET /api/cron/generate-monthly-rent`
   (`routes-pg/cron.js`), configured to run monthly via `vercel.json`'s
   `crons` array.

Both call the exact same function. There is no separate copy of the
charge-generation logic to drift out of sync between the two paths.

## Idempotency -- the actual point of this phase

Running this job twice for the same resident and month must be a no-op,
not a duplicate charge. That guarantee already existed since Phase 1: a
partial unique index on `charges(resident_id, period_month) WHERE type =
'monthly_rent'`. This phase's `INSERT ... ON CONFLICT (resident_id,
period_month) WHERE type = 'monthly_rent' DO NOTHING` targets that exact
index. This is what makes it safe to have two independent trigger
mechanisms for the same job without any coordination between them -- if
both a Vercel Cron and a manually-run CWP script somehow fired for the
same month, the second one simply does nothing.

## The charged amount comes from the resident's contract, not the room's current listing

The job charges each active resident's `resident_assignments.rent_at_assignment`
-- the rate they were actually given at their last check-in or transfer --
not `rooms.monthly_rent`. If the hostel raises a room's listed rent
tomorrow, that shouldn't silently change what an existing resident already
agreed to pay; only their next transfer (which records a fresh
`rent_at_assignment`) would.

## The Vercel Cron endpoint fails closed

`GET /api/cron/generate-monthly-rent` isn't behind a login session --
Vercel Cron doesn't have one -- so it's protected by a shared secret
(`CRON_SECRET`) that Vercel sends as `Authorization: Bearer <secret>` when
configured. If `CRON_SECRET` isn't set at all, the endpoint refuses every
request with `503` rather than ever running unauthenticated in a public
deployment.

## What I actually tested (against the live app and real Postgres)

- Checked in a resident (which, per Phase 7, already generates that
  month's rent charge at check-in).
- HTTP endpoint with no Authorization header -> `401`. With the wrong
  secret -> `401`. With the correct secret -> ran successfully but
  correctly reported `createdCount: 0, skippedCount: 1` -- it recognized
  September's charge already existed from check-in.
- With `CRON_SECRET` unset entirely -> `503`, even when a request
  supplied a plausible-looking Authorization header. Fails closed, not
  open.
- Ran the CLI script directly for the same month -> same correct skip.
- Ran the job for October (a genuinely new month) -> created exactly one
  charge, at `32000` -- the resident's actual contracted rent.
- Ran October generation a second time -> `createdCount: 0`, confirmed
  via direct database query that still only one October charge exists.
- Checked the resident out, then ran generation for November -> `0`
  active residents considered, nothing generated -- checked-out residents
  are correctly excluded.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

CWP / any VPS with crontab:
```bash
# crontab -e, running at 00:05 on the 1st of every month
5 0 1 * * cd /path/to/hostel-system && /usr/bin/node jobs/generate-monthly-rent.js >> /var/log/hms-rent.log 2>&1
```

Vercel: already configured in `vercel.json` (`"schedule": "0 0 1 * *"`) --
just set a `CRON_SECRET` environment variable in your Vercel project
settings and Vercel handles the rest.

Manually, either way:
```bash
npm run generate-monthly-rent
```

## What's next: Phase 12 -- Common Mess

An entirely separate ledger from everything built so far --
`mess_members`, `menus`, `meal_records`, and `mess_expenses` (all built in
Phase 1, migration 012) -- shared across all branches, with no
relationship to `charges` at all. This phase adds the routes: managing
mess membership, recording meals eaten (which doubles as attendance), and
tracking groceries and other mess expenses.

Phases remaining after that (13 total): Expenses (13), Branch revenue/
financial analysis (14), Dashboard (15), Reports (16), Global Search (17),
Notices/Notifications (18), Resident Portal UI (19), Audit Logs UI (20),
System Settings (21), Security hardening (22), Performance optimization
(23), Complete QA (24), Vercel production deployment verification (25).
