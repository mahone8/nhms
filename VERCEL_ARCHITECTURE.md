# Vercel-Compatible Backend Architecture — Phase 2

This phase proves the application *can* run as stateless Vercel serverless
functions against pooled Postgres, with no in-memory session store and no
local filesystem dependency. It does **not** yet move any real feature
(auth, branches, residents, ...) onto Postgres — that happens phase by
phase (Phase 3 onward), per the implementation order in
`db/POSTGRES_SCHEMA.md`. The legacy SQLite app (`server.js` + `routes/`)
is untouched and still fully working; it was re-verified after this phase.

## Why the legacy app couldn't just be deployed to Vercel as-is

Three things in the original app assume a single, always-running process —
none of which hold true on Vercel, where each request can land on a
different, freshly-started serverless instance with no shared memory:

1. **`express-session`'s default store is in-memory.** A login on one
   instance would be invisible to the next request if it landed on a
   different (or newly cold-started) instance.
2. **Menu images were saved to local disk** (`public/uploads/menu/`).
   Vercel's filesystem is read-only at runtime except for `/tmp`, and even
   `/tmp` doesn't persist between invocations or deployments.
3. **A single `pg.Pool` created per request** would exhaust Neon's
   connection limit under real concurrency, since serverless can spin up
   many concurrent instances.

## What this phase adds

| File | Purpose |
|---|---|
| `app.js` | The new production Express app. Postgres-backed, stateless. Exports the app instance instead of calling `.listen()` directly, so the exact same app runs locally (`npm run dev:prod`) and on Vercel. |
| `api/[...path].js` | Vercel's catch-all serverless entrypoint. Just re-exports `app.js` — Vercel's Node runtime calls it as a standard `(req, res)` handler, since that's exactly what an Express app already is. (Explicitly **not** using `serverless-http`, which adapts to AWS Lambda's event format — the wrong shape for Vercel's Node runtime, and an unnecessary dependency here.) |
| `db/pool.js` | A `pg.Pool`, cached on `global` so a warm serverless instance reuses it across invocations instead of opening new connections each time. In production, `DATABASE_URL` should be Neon's *pooled* connection string (the one with `-pooler` in the hostname). |
| `lib/jwt.js` | Stateless auth: signs the user's identity into a JWT, stored as an httpOnly cookie. No server-side session store of any kind. Includes `requireRole(...)` middleware for role-gated routes — the mechanism Phase 3 (Authentication and RBAC) will build real login routes on top of. |
| `lib/jwt.test.js` | Direct tests of the above (see "What I tested" below). |
| `vercel.json` | Minimal function config (memory/timeout) for the catch-all function. No routing rules needed — Vercel serves `public/` as static files automatically for anything outside `/api/*`. |

## What I actually tested

- **`npm run test:jwt`** — signs and verifies a token; confirms a tampered
  token and a garbage string are both rejected; then runs a real Express
  server through a full request cycle: an unauthenticated request to a
  protected route gets `401`, logging in sets a genuinely `HttpOnly`
  cookie, that cookie grants access to an admin-only route with the
  correct user attached, and the *same* cookie is correctly rejected
  (`403`) by a super-admin-only route — proving role enforcement, not just
  authentication, works.
- **`npm run dev:prod`** (starts `app.js` locally against the real Neon-
  compatible Postgres from Phase 1) — `GET /api/health` returns the
  database's current time via a real round trip through the pooled client,
  proving `app.js -> db/pool.js -> Postgres` works end to end.
- **Connection reuse** — hit `/api/health` five times in a row and checked
  `pg_stat_activity`: only 2 pooled connections were ever open, not 5,
  confirming the `global`-cached pool is actually being reused rather than
  recreated per request.
- **Static file serving** — `GET /` and `GET /css/style.css` against the
  new app both return `200`, confirming `express.static` still works
  locally (this becomes a no-op on Vercel itself, where those paths are
  served directly from `public/` without invoking the function at all).
- **Legacy app regression check** — started `server.js` (the SQLite app)
  after all of the above and confirmed the login page and admin login
  still return `200` exactly as before. Nothing in this phase touched it.

## Running it yourself

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, and add JWT_SECRET (any long random string)
npm run migrate        # if you haven't already, from Phase 1
npm run test:jwt       # verify the auth mechanism in isolation
npm run dev:prod       # starts app.js locally on :3001 (or PORT env var)
curl http://localhost:3001/api/health
```

## Deploying this phase to Vercel

1. Push the repo to GitHub, import it into Vercel.
2. In Vercel's project settings, add environment variables: `DATABASE_URL`
   (Neon's pooled connection string) and `JWT_SECRET`.
3. Deploy. `GET /api/health` on the deployed URL should return `{"ok":
   true, "dbTime": ...}`. If you haven't already, run `npm run migrate`
   with `DATABASE_URL` pointed at the same Neon database first (migrations
   are a one-off script, run from your machine or CI — not something the
   deployed app runs itself).

## Not yet done (upcoming phases)

- Real login/logout routes backed by the `users` table, and RBAC
  enforcement across actual feature routes (Phase 3).
- Every feature currently living only in the SQLite app (branches, rooms,
  beds, residents, payments, menu, accounts) gets rebuilt against Postgres
  one phase at a time, in the order listed in `db/POSTGRES_SCHEMA.md`.
- Object storage for uploads (or Postgres `bytea`) — needed once the menu
  feature is rebuilt, since local disk still isn't an option in production.
