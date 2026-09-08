# Global Search — Phase 17

One search endpoint, usable by every role -- but what an Admin can find
and what a resident can find are structurally different, not just
filtered differently after the fact.

## What's new

`routes-pg/search.js` -- `GET /api/search`, accepting `q` (matched
against name, CNIC, phone, student ID, room number, or bed number) plus
filters for branch, room type, bathroom type, room, bed, university,
department, status, and payment status (the last one computed via
Phase 9's `lib/dues.js`, since it isn't a stored column). Also searches
receipt numbers, returning matching payments separately.

## "Resident users must only search/view their own permitted information" -- enforced in the WHERE clause, not after

The spec is explicit about this, and it's the whole point of this phase.
Rather than running a normal search and then checking whether the
results belong to the requester, a resident's query gets
`residents.id = <their own id>` baked into the SQL from the start. Every
other filter (branch, university, whatever) is AND-ed onto that scope,
which means those filters can only ever narrow their own single result
down to nothing -- there is no combination of query parameters that can
widen it to include anyone else, because the id constraint isn't a
filter that composes with others, it's the boundary everything else
operates inside of.

## A subtle bug this phase's own testing caught

The first version scoped residents by ID correctly but forgot to also
apply the text match when that ID scope was active -- so a resident
searching literally anything (their own name, a stranger's name, random
gibberish) always got their own record back, as long as no other filter
excluded them. This never leaked anyone else's data (the ID scope alone
guaranteed that), but it was wrong in a different way: typing another
resident's exact name and getting a "match" back that wasn't actually a
match is confusing and looks like a bug even though it was safe. Fixed by
applying the same text-matching condition for residents too, AND-ed with
their ID scope -- now their search actually has to match something of
theirs to return it, while remaining structurally incapable of ever
returning someone else's.

## What I actually tested (against the live app and real Postgres)

Set up two residents sharing an identical CNIC on purpose, specifically
to test whether that shared value could be exploited to see each other's
data:

- Admin searching that shared CNIC -> found both residents, as expected
  for an admin.
- Admin searching a receipt number -> found it, with the correct
  resident's name attached.
- The critical test: the first resident searching that exact same shared
  CNIC -> found only herself, `receipts: []` -- despite the second
  resident's data objectively matching the same query string.
- Direct attack: searched the second resident's exact receipt number ->
  empty. Searched her name directly -> empty (after the fix above;
  before it, incorrectly returned the first resident's own record instead
  of empty -- never leaked data, but wrong).
- Tried to widen results with a filter matching the other resident's
  branch -> still empty, never the other resident.
- Unauthenticated request -> `401`.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt "localhost:3001/api/search?q=Ayesha"
curl -b admin.txt "localhost:3001/api/search?university=NFC%20IEFR&paymentStatus=overdue"
curl -b resident.txt "localhost:3001/api/search?q=anything" # only ever returns their own data, if it matches
```

## What's next: Phase 18 -- Notices / Notifications

The `notices` and `notifications` tables have existed since Phase 1
(migration 013) with the exact target-scoping (all/branch/resident) and
read/unread tracking spec describes. This phase adds the routes: an
Admin/Super Admin composing and targeting a notice, and residents
fetching the notices that apply to them -- another case where the query
needs to be scoped by who's asking, following the same pattern
established in this phase and Phase 9.

Phases remaining after that (7 total): Resident Portal UI (19), Audit
Logs UI (20), System Settings (21), Security hardening (22), Performance
optimization (23), Complete QA (24), Vercel production deployment
verification (25).
