# Resident Portal (UI) — Phase 19

The first real frontend for the Postgres/Vercel app since Phase 2's
architecture skeleton -- everything before this was API-only. Kept
entirely separate from the legacy app's /resident/ pages (different
path, /portal/), so both continue to work side by side.

## What's new

- `public/portal/index.html` + `public/js/portal-login.js` -- login page
  posting to the same `/api/auth/login` built in Phase 3, rejecting
  non-resident accounts with a clear message.
- `public/portal/app.html` + `public/js/portal-app.js` -- the app shell
  and all eight sections from spec section 28: Dashboard, My Profile, My
  Room, My Dues, Payment History, Receipts, Stay Information, Notices.
- Two small backend additions this phase needed, both in
  `routes-pg/residents.js`:
  - `rooms.monthly_rent` added to the shared resident query (was never
    selected before -- nothing had needed it until the Dashboard did).
  - `GET /me/stay-history` -- a resident-facing version of Phase 8's
    stay history, registered before the admin gate (the same ordering
    rule established in Phases 9/10/18), and taking no ID parameter at
    all, so there's no ID to guess in the first place.

## The Dashboard composes three existing endpoints, doesn't duplicate them

Rather than build a new resident-dashboard-specific backend endpoint, the
frontend calls `GET /residents/me`, `GET /residents/me/dues`, and
`GET /payments/me` (taking the first result as "last payment," since it's
already sorted newest-first) and assembles them client-side. Same
principle as Phase 15's admin dashboard: composition over duplication, so
the numbers can never drift from what the dedicated pages for each of
those show.

## Two gaps caught on a final pass against the spec's own field lists

Spec sections 29-32 give the exact fields each portal page should show --
checking against them directly (rather than just my own memory of what
I'd built) caught two real gaps:

- Section 29's "Resident Profile" wants a Hostel block (Branch, Floor,
  Room, Bed, Room type, Bathroom type, Joining date, Expected checkout,
  Status) as part of the profile page. My Profile only had Personal and
  Education. Added the Hostel card, including Expected checkout, which
  wasn't displayed anywhere in the portal until this fix.
- Section 32's "Payment History" wants a Status column per payment. Added
  one -- "Completed" for a normal payment, "Refunded" for a
  `payment_type: 'refund'` row, since that's the only payment-level
  status distinction this system's data actually supports (there's no
  pending/failed payment state -- a payment only exists once it's been
  recorded as received).

Verified the underlying data for both (`expectedCheckoutDate`, `floor`)
is present and correctly formatted in the API response the fixed page
consumes.

## What I actually tested (against the live app and real Postgres)

- All four new static files serve correctly (200) from their new
  /portal/ paths.
- Checked in a resident with full profile details, a payment, and a
  notice, then verified every field every portal page needs is present
  and correct in the underlying API responses: monthly rent, room/bed,
  outstanding balance and due date, education fields, payment history
  with receipt number, a full receipt (including room/bed resolved at
  payment time, per Phase 10), and the notice.
- IDOR test on the new stay-history route: checked in a second resident,
  confirmed the first resident's /me/stay-history returned only her own
  record (verified every row's branch matched), and the second
  resident's returned only hers -- correctly isolated by construction,
  since the route reads no ID from the request at all.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

Visit /portal/ in a browser, sign in with a resident account, e.g. one
created in earlier phases' testing, and click through the sidebar.

## What's next: Phase 20 -- Audit Logs (UI)

GET /api/audit-logs has existed since Phase 3 -- Super Admin only, and
already the single place every phase's logAction() calls have been
writing to since then. This phase is a thin admin-facing UI over data
that's already being correctly and completely recorded; no new backend
logic, just a page to browse it.

Phases remaining after that (5 total): System Settings (21), Security
hardening (22), Performance optimization (23), Complete QA (24), Vercel
production deployment verification (25).
