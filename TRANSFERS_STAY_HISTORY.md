# Transfers / Stay History — Phase 8

Moving an active resident to a different bed — possibly a different room,
possibly a different branch entirely — without ever losing or rewriting
where they've been before.

## What's new

`routes-pg/transfers.js`:

| Route | Purpose |
|---|---|
| `POST /api/transfers` | Transfer an active resident to a new bed. One destination parameter (`bedId`) covers branch, room, *and* bed, since a bed belongs to exactly one of each. |
| `GET /api/residents/:id/stay-history` | The resident's full timeline — every `resident_assignments` row, oldest first. |

Also: migration `018_assignment_notes.sql` adds a `notes` column to
`resident_assignments`, so a transfer's specific reason ("requested a
quieter room", "branch relocation") can be recorded — not just the
category (`transfer`) that was already there.

## Why stay history needed almost no new code

`resident_assignments` was designed in Phase 1 specifically so that
check-in, transfer, and check-out would all be "close the current row
(set `end_date`), optionally open a new one" — never an `UPDATE` of a
past row's branch/room/bed. Phase 8's transfer route follows exactly that
pattern, so "preserve historical branch/room/bed" isn't something the
route has to be careful about — it's structurally true, the same way it
already was for check-out in Phase 7.

## Validation and the same race-condition discipline as check-in

A transfer validates the destination (branch active, room active) and
then re-verifies the bed is genuinely `available` with
`SELECT ... FOR UPDATE` inside the transaction — identical protection to
Phase 6's bed selection and Phase 7's check-in, for the same reason: time
passes between "an admin decides to transfer someone" and "the request
actually executes," and something else could have claimed that bed in
between.

## A real bug this phase's testing caught

The "you can't transfer someone to their own current bed" check compared
`resident.bed_id === Number(bedId)` — but `node-pg` returns `bigint`
columns as JavaScript strings, so this was comparing `"1" === 1`, which is
always `false`. The check silently never fired. It didn't cause incorrect
*behavior* (attempting to transfer into your own occupied bed still got
rejected, just via the generic "destination bed is not available" message
instead of the friendlier one meant for this specific case) — but it's
exactly the kind of bug that matters more once other bigint comparisons
get added in later phases. Fixed by comparing `Number(resident.bed_id) ===
Number(bedId)`, and checked the rest of the codebase for the same pattern
(found only this one instance).

## What I actually tested (against the live app and real Postgres)

- Checked a resident in (branches/rooms/beds already set up), then:
- Resident role → transfer → `403`.
- Attempted to transfer them to their own current bed → correctly
  rejected (and, after the fix, with the specific friendly message).
- Transferred them to a bed in a **different branch entirely**, with a
  transfer reason — confirmed the response showed the new branch, room,
  and bed, and the resident's `status` stayed `active` throughout.
- Attempted to transfer into a bed that was already `occupied` → `409`.
- Fetched the resident's full stay history afterward — two rows exactly
  as expected: the original check-in assignment, **closed** with an
  `endDate` (not deleted, still showing the original branch/room/bed), and
  the new transfer assignment, open (`endDate: null`), carrying the notes
  text through correctly.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app —
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/transfers -H "Content-Type: application/json" \
  -d '{"residentId":5,"bedId":42,"reason":"Requested a quieter room"}'

curl -b admin.txt localhost:3001/api/residents/5/stay-history
```

## What's next: Phase 9 — Rent / Charges

The `charges` table has existed since Phase 1 and check-in already
populates it (registration fee, security fee, first month's rent) — what
this phase adds is the management layer around it: viewing/filtering a
resident's or branch's charges, manually adding a one-off charge or
adjustment (a discount, a damage fee, etc.), and the reporting queries
("what's outstanding, per resident / per branch") that Payments (Phase 10)
and the Dashboard (Phase 15) will both build on.

Phases remaining after that (16 total): Payments/Receipts (10), Automatic
monthly rent (11), Common Mess (12), Expenses (13), Branch revenue/
financial analysis (14), Dashboard (15), Reports (16), Global Search (17),
Notices/Notifications (18), Resident Portal UI (19), Audit Logs UI (20),
System Settings (21), Security hardening (22), Performance optimization
(23), Complete QA (24), Vercel production deployment verification (25).
