# Deployment Guide — Clean, Error-Free Setup

Every step below has actually been run and verified against a real
Postgres database during development. This covers both supported
targets: Vercel + Neon and a self-hosted CWP VPS. Pick one.

The single most common source of "it's broken" in a deployment like this
is skipping a step, not a bug in the code -- this guide is written to
prevent that.

---

## Before either path: what you need to decide

- A Postgres database. Either Neon (free tier is fine) or a Postgres
  instance on your own server (CWP includes PostgreSQL support).
- Two secrets, generated fresh -- never reuse the ones in this repo's
  docs or tests:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  Run this twice -- once for JWT_SECRET, once for SESSION_SECRET (only
  needed if you're also running the legacy SQLite demo app; skip it if
  not). If deploying to Vercel, run it a third time for CRON_SECRET.

---

## Path A: Vercel + Neon

### 1. Create the database
Create a free project at neon.tech. From the dashboard, copy the pooled
connection string -- the one with "-pooler" in the hostname. This
matters: Neon's pooler is what keeps serverless functions from
exhausting the connection limit under real traffic (see db/pool.js's
comment, and VERCEL_ARCHITECTURE.md).

### 2. Run migrations -- from your own machine, not from Vercel
```bash
git clone <your repo>
cd hostel-system
npm install
DATABASE_URL="<your Neon pooled connection string>" npm run migrate
```
You should see "Applied 19 migration(s) successfully." If you see
"relation X does not exist" errors later, it means this step was
skipped or ran against the wrong database -- double check DATABASE_URL.

### 3. Create your real Super Admin -- not the demo one
```bash
DATABASE_URL="postgresql://neondb_owner:npg_C6I0ZvleaKVO@ep-bitter-frog-ax68nq6g-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" node db/create-super-admin.js \
  --name "Levelose" --username youruser --password "L£velose5716"
```
Do not run `npm run seed:pg` for a real deployment -- that creates demo
branches/beds and a "superadmin / SuperAdmin123!" account whose password
is written in this repo's own documentation.

### 4. Deploy to Vercel
Push to GitHub, import the repo into Vercel. In the Vercel project's
Environment Variables settings, add:

| Variable | Value |
|---|---|
| DATABASE_URL | your Neon pooled connection string |
| JWT_SECRET | the one you generated above |
| CRON_SECRET | the one you generated above (enables the monthly rent job) |
| NODE_ENV | production |

Deploy. Vercel auto-detects api/[...path].js and vercel.json's crons
entry -- no extra configuration needed there.

### 5. Verify it actually works
```bash
curl https://your-app.vercel.app/api/health
```
Should return {"ok":true,"dbTime":"..."}. If instead you get a 500 or a
connection error, DATABASE_URL is wrong or migrations weren't run
(step 2).

```bash
curl -c cookies.txt -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"youruser","password":"your password"}'
```
Should return your Super Admin's info. Then visit
https://your-app.vercel.app/admin-portal/ in a browser and sign in.

The monthly rent cron job is already scheduled (vercel.json, 0 0 1 * *)
and needs no further setup -- Vercel sends the CRON_SECRET automatically.
To confirm it's registered, check the Cron Jobs tab in your Vercel
project dashboard. (Confirmed current as of testing: Vercel now allows
cron jobs on every plan including Hobby, up to once-per-day frequency --
our once-a-month schedule fits comfortably within that.)

### Common Vercel-specific mistakes
- Forgetting NODE_ENV=production -- without it, auth cookies aren't
  marked secure, which is a problem the other direction if you set it
  without HTTPS (not an issue on Vercel, which is HTTPS by default --
  but see the CWP warning below).
- Using the unpooled Neon connection string -- works fine at low
  traffic, then starts throwing "too many connections" errors as usage
  grows. Use the -pooler one from the start.
- Running `npm run seed:pg` in production -- creates a fully public,
  documented admin password. If you did this by accident, immediately
  change that account's password via PATCH /api/users/:id (or delete it
  and bootstrap a real one).

---

## Path B: Self-hosted CWP VPS

### 1. Get PostgreSQL running
CWP includes PostgreSQL support (with phpPgAdmin) alongside its default
MariaDB. Create a database and a role for the app through CWP's database
manager, or via psql directly if you have SSH/root access:
```bash
sudo -u postgres psql -c "CREATE USER hms_app WITH PASSWORD 'a-real-password';"
sudo -u postgres psql -c "CREATE DATABASE hostel_management OWNER hms_app;"
```

### 2. Get the code onto the server and install
```bash
git clone <your repo> /home/yourcwpuser/hostel-system
cd /home/yourcwpuser/hostel-system
npm install
```
Requires Node.js 18 or later for the production app (app.js). If you
also want to run the legacy SQLite demo (server.js), that specifically
needs Node 22.5+ for node:sqlite -- not required for the real,
Postgres-backed app.

### 3. Set environment variables via a .env file
```bash
cp .env.example .env
```
Edit .env:
```
DATABASE_URL=postgres://hms_app:a-real-password@localhost:5432/hostel_management
JWT_SECRET=<generated above>
NODE_ENV=production
```
(dotenv -- already a dependency -- loads this file automatically; see
db/pool.js.) Leave CRON_SECRET unset -- it's only for the Vercel HTTP
cron path, and leaving it blank makes that endpoint permanently refuse
requests (fails closed), which is exactly what you want since you'll use
native cron instead (step 6).

### 4. Run migrations and bootstrap your Super Admin
```bash
npm run migrate
node db/create-super-admin.js --name "Your Name" --username youruser --password "a genuinely strong password"
```
Same as the Vercel path -- do not run `npm run seed:pg` in production.

### 5. Get HTTPS working before you rely on login working
This is the mistake most likely to cause a confusing, silent failure: if
NODE_ENV=production is set (step 3), auth cookies are marked secure,
which browsers will only send over HTTPS. Set up SSL first -- CWP
includes AutoSSL/Let's Encrypt support through its interface -- then
proceed. If you need to test over plain HTTP temporarily, remove
NODE_ENV=production from .env for that testing only, and put it back
before going live.

### 6. Run the app as a persistent process

If CWP's Node.js Selector is installed (a CloudLinux add-on many CWP
installs include): use its "Setup Node.js App" interface, point the
Application startup file at app.js, set the environment variables from
step 3 there instead of (or in addition to) the .env file, and let it
manage npm install and process lifecycle for you.

If it isn't, run the app with PM2 (works on any VPS regardless of panel
features) and reverse-proxy to it:
```bash
npm install -g pm2
pm2 start app.js --name hostel-management
pm2 save
pm2 startup   # follow the printed instructions to survive a reboot
```
Then configure an Nginx or Apache vhost (via CWP's web server config) to
reverse-proxy your domain to http://127.0.0.1:3001 (or whatever PORT you
set).

### 7. Set up the monthly rent cron job
```bash
crontab -e
```
Add:
```
5 0 1 * * cd /home/yourcwpuser/hostel-system && /usr/bin/node jobs/generate-monthly-rent.js >> /var/log/hms-rent.log 2>&1
```
(Or add this through CWP's Cron Jobs UI instead of raw crontab, if you
prefer -- same command either way.)

### 8. Verify it actually works
```bash
curl https://your-domain.com/api/health
```
Should return {"ok":true,"dbTime":"..."}.
```bash
curl -c cookies.txt -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"youruser","password":"your password"}'
```
Then visit https://your-domain.com/admin-portal/ and sign in.

Test the cron job manually once before trusting the schedule:
```bash
cd /home/yourcwpuser/hostel-system && node jobs/generate-monthly-rent.js
```

### Common CWP-specific mistakes
- Login "not working" with no clear error -- almost always the
  NODE_ENV=production + no-HTTPS-yet issue from step 5. Check whether
  your login POST succeeds (200 with user info) but the next request
  still shows user: null -- that's the cookie not being sent, which
  means secure-cookie-over-HTTP.
- npm install fails with permission errors -- don't run it as root if
  the app will run as a regular user; match the user PM2 (or the Node.js
  Selector) will actually run as.
- Using the wrong Node version for the legacy demo app -- only relevant
  if you're also running server.js; the real app (app.js) doesn't need
  Node 22.5+.

---

## Either path: keeping migrations in sync going forward

Every phase after this point that adds a new migration file needs
`npm run migrate` run against your production database before that
phase's code goes live -- the app assumes the schema it expects already
exists; it doesn't create tables on the fly. Re-running `npm run migrate`
is always safe (it tracks what's already applied and skips it), so
making it part of your normal deploy process (before restarting the app
on CWP, or as a manual step before pushing to Vercel) avoids the single
most common real-world error in a setup like this: code expecting a
column or table that isn't there yet.
