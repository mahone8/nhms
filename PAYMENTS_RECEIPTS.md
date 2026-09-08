# Payments / Receipts — Phase 10

Recording real payments against a resident, generating unique receipts,
and letting residents view their own payment history — this is the phase
that finally makes `amountPaid` in Phase 9's dues view become non-zero.

## What's new

| File | Purpose |
|---|---|
| `lib/receipts.js` | Unique receipt number generation, and assembling the full receipt (every field spec section 20 requires). |
| `routes-pg/payments.js` | `POST /api/payments`, `GET /api/payments`, `GET /api/payments/:id`, `GET /api/payments/me`, `GET /api/payments/me/:id`. |

## The receipt, exactly as spec section 20 lists it

Hostel name, receipt number, resident name, CNIC, branch, room, bed,
payment date, type, amount, method, who received it, and remaining
balance afterward. Room/bed are resolved as of the payment date via
`resident_assignments`, not the resident's current placement -- a receipt
is a historical document, so if the resident transfers rooms next month,
last month's receipt should still show where they were when they actually
paid.

## Two real correctness bugs this phase caught

**1. Refunds were about to corrupt the outstanding-balance math.**
`lib/dues.js` (Phase 9) summed all payments as "amount paid toward
charges." The moment this phase introduced actual `refund`-type payments,
that would have been wrong -- a refund is money going back to the
resident, and summing it into "amount paid" would make it look like they
had paid more than they had, artificially shrinking their outstanding
balance. Fixed: `amountPaid` now excludes `payment_type = 'refund'`, and a
new `totalRefunded` field reports it separately. Applied the same fix to
Phase 7's checkout-preview by having it reuse `lib/dues.js` directly
instead of maintaining a second, now-inconsistent copy of the same
calculation.

**2. A severe, systemic routing bug -- the same class of bug from Phase 9,
but worse.** `checkin-checkout.js` and `transfers.js` are both mounted at
the bare `/api` root (not a specific prefix like `/api/payments`), and
each had `router.use(requireRole("admin", "super_admin"))` at the top. In
Express, a path-less `router.use()` runs for every request that reaches
that router -- and because these two are mounted at the shared `/api`
root, "every request that reaches that router" meant any `/api/*` request
not already claimed by a more specific mount registered earlier.
Concretely: `GET /api/payments/me` was being silently intercepted and
rejected by `checkin-checkout.js`'s blanket admin-only gate, purely
because that file happened to be registered before `payments.js` in
`app.js` -- a resident got `403` trying to see her own payment history,
for a reason that had nothing to do with payments at all.

This is worse than Phase 9's version of the bug because it wasn't scoped
to one path prefix -- it could have silently broken any future
resident-facing route mounted anywhere near these two files. Fixed by
removing the blanket `router.use()` from both files entirely and applying
`requireRole(...)` individually to each of their five routes instead,
which only ever affects requests that actually match one of those
specific routes. Then audited every remaining
`router.use(requireRole(...))` in the codebase (nine of them) and
confirmed each one lives in a router mounted at its own specific prefix
(`/api/branches`, `/api/payments`, etc.), where this failure mode cannot
occur -- sibling routers at different prefixes never see each other's
middleware.

## What I actually tested (against the live app and real Postgres)

- Recorded a real payment against a checked-in resident -- the response
  was a full receipt with a generated number (`HMS-1-20260904-77BB`),
  correct room/bed, and `remainingBalance: 20000` (52,000 charged minus
  32,000 just paid) computed correctly in the same request.
- Negative amount, zero amount, and an invalid payment type all rejected
  with clean `400`s.
- Resident role -> record a payment -> `403`.
- Retested after the routing fix: the resident could now correctly see
  her own payment list and her own receipt by ID.
- IDOR test: created a second resident's payment, then had the first
  resident guess its ID via `/api/payments/me/:id` -- got `404` (not
  `403`, deliberately not confirming a payment with that ID even exists)
  instead of ever seeing the other resident's receipt.
- Resident role -> the general admin payments browser -> `403`.
- Regression-checked that check-in and check-out still correctly require
  admin, and still function correctly for admins, after removing their
  blanket gates.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app --
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt -X POST localhost:3001/api/payments -H "Content-Type: application/json" \
  -d '{"residentId":5,"amount":32000,"paymentType":"monthly_rent","paymentMethod":"cash"}'

curl -b resident.txt localhost:3001/api/payments/me
```

## What's next: Phase 11 -- Automatic monthly rent

A scheduled job (Vercel Cron-compatible, per Phase 2's architecture) that
generates each active resident's next `monthly_rent` charge automatically
-- reusing the exact idempotency guarantee already built into the
`charges` table in Phase 1 (`UNIQUE(resident_id, period_month) WHERE type
= 'monthly_rent'`), so running the job twice for the same month is safely
a no-op rather than a duplicate charge.

Phases remaining after that (14 total): Common Mess (12), Expenses (13),
Branch revenue/financial analysis (14), Dashboard (15), Reports (16),
Global Search (17), Notices/Notifications (18), Resident Portal UI (19),
Audit Logs UI (20), System Settings (21), Security hardening (22),
Performance optimization (23), Complete QA (24), Vercel production
deployment verification (25).
