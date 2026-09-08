# Rent / Charges — Phase 9

The management and reporting layer on top of the `charges` table, which
has existed since Phase 1 and which check-in has been populating since
Phase 7. This phase adds: the resident dues view exactly as spec section
17 describes it, a general filterable charges browser, and the ability to
manually add a one-off charge, discount, or adjustment.

## The resident dues view

`GET /api/residents/:id/dues` (Admin/Super Admin) and
`GET /api/residents/me/dues` (the resident's own, IDOR-safe) both return
exactly the fields spec section 17 lists:

> Monthly Rent, Security Fee, Registration Fee, Other Charges, Previous
> Outstanding, Total Charges, Amount Paid, Remaining Balance, Due Date,
> Status

`Outstanding = Total Charges - Total Paid`, computed at the resident
level (not per-charge) — this matches the design already documented for
the `payments` table back in Phase 1, since charges and payments aren't
reconciled one-to-one in this schema. "Previous Outstanding" specifically
means the balance as it stood *before* the most recent month's rent
charge — i.e. everything except that one line.

## A genuinely important architecture bug this phase caught

My first pass put the new resident-facing dues route in a separate file
mounted at `/api`. It never worked: `routes-pg/residents.js` is mounted at
`/api/residents` with `router.use(requireRole("admin", "super_admin"))` —
and in Express, a path-less `router.use()` applies to **every** request
under that mount, whether or not any specific route inside the router
actually matches. So `GET /api/residents/me/dues`, defined in a totally
different file, was getting intercepted and rejected by `residents.js`'s
admin-only gate before it ever had a chance to run — the resident got
`403` instead of ever reaching their own dues.

This is not a one-off glitch: it turns out Phase 7's `checkout-preview`
and Phase 8's `stay-history` routes have the exact same structural issue
— they're both defined in separate files at `/residents/:id/...` paths
that fall under `residents.js`'s mount. They "worked" purely because they
happen to require the same role (`admin`/`super_admin`) as that blanket
gate, so being redundantly re-checked by it was invisible. The first time
a resident-scoped route showed up at that path shape, the coincidence
broke.

**Fix:** moved the dues routes (and the manual charge-creation route)
directly into `residents.js` itself, positioned correctly relative to its
existing gate. Left Phase 7/8's routes where they are (moving them wasn't
necessary for correctness today), but added explicit comments at both
call sites explaining the trap, so any future phase adding a
resident-scoped route knows to put it in `residents.js`, not in a
separate file at the same path prefix.

## What's new

| File | Purpose |
|---|---|
| `lib/dues.js` | The shared dues-computation logic, extracted so `residents.js` and any future phase (Reports, Dashboard) can reuse it without duplicating the math. |
| `routes-pg/residents.js` (extended) | `GET /me/dues`, `GET /:id/dues`, `POST /:id/charges`. |
| `routes-pg/charges.js` | `GET /api/charges` — a general, filterable browser across all residents/branches. |

## Common Mess charges stay separate — enforced by construction

Spec section 17: *"Common Mess charges must NOT be included in resident
hostel dues. Mess finances must remain completely separate."* This holds
structurally, not by a rule someone has to remember: the mess tables
(`mess_expenses`, `meal_records`, from migration 012) have no foreign key
or relationship to `charges` at all. Nothing in this phase writes to
`charges` for a mess reason, and `lib/dues.js` has a comment flagging this
explicitly for whoever builds Phase 12.

## What I actually tested (against the live app and real Postgres)

- Computed dues for a resident with real check-in charges (registration
  fee, security fee, first month's rent = 52,000 total) — every field
  matched by hand: `totalCharges: 52000`, `amountPaid: 0`,
  `remainingBalance: 52000`, `status: "overdue"` (correctly, since the
  due date had passed with nothing paid).
- **Found and fixed the routing bug above** — verified `/me/dues` now
  correctly returns `404` ("no resident profile linked") for a resident
  account with no linked profile, instead of the wrong `403`.
- Resident role → another resident's dues by ID → still correctly `403`.
- General charges browser, filtered by resident — returned the right 3
  rows.
- Added a manual `-2000` discount — dues recomputed correctly:
  `otherCharges: -2000`, `totalCharges` dropped from 52,000 to 50,000.
- Re-verified Phase 7's `checkout-preview` and Phase 8's `stay-history`
  routes both still return `200` after the comment-only changes.
- Cleaned up test data, re-ran Phase 2's JWT suite and the legacy app —
  both still fully working.

## Trying it yourself

```bash
curl -b admin.txt localhost:3001/api/residents/5/dues
curl -b admin.txt -X POST localhost:3001/api/residents/5/charges \
  -H "Content-Type: application/json" -d '{"type":"discount","amount":-2000,"description":"Loyalty discount"}'
curl -b admin.txt "localhost:3001/api/charges?branch=Nazzal&type=monthly_rent"
```

## What's next: Phase 10 — Payments / Receipts

Recording actual payments against a resident (which is what makes
`amountPaid` in this phase's dues view become non-zero for the first
time), generating receipt numbers, and viewing payment history. This is
also where the `checkout-preview`'s "possible refund" figure from Phase 7
gets a real mechanism to act on it (a `payment_type: 'refund'` row).

Phases remaining after that (15 total): Automatic monthly rent (11),
Common Mess (12), Expenses (13), Branch revenue/financial analysis (14),
Dashboard (15), Reports (16), Global Search (17), Notices/Notifications
(18), Resident Portal UI (19), Audit Logs UI (20), System Settings (21),
Security hardening (22), Performance optimization (23), Complete QA (24),
Vercel production deployment verification (25).
