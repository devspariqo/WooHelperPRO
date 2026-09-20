# Deploying WooHelperPro on Hostinger Web Apps

A step-by-step guide, plus one decision you have to make first.

---

## Read this before you start: SQLite cannot live on Hostinger's filesystem

This project ships with SQLite (`DATABASE_URL="file:./woohelperpro.db"`). Hostinger's Node.js
Web Apps run your code from a **versioned build directory**:

```
~/domains/{domain}/hbuilds/
├── versions/{build-id}/nodejs/   ← your app runs from here
└── current → versions/{build-id}  ← symlink, re-pointed on every deploy
```

Two consequences, both fatal to SQLite:

1. **Every deploy re-points `current` to a brand-new `versions/{build-id}` folder.** Only the
   live build and one previous build are kept. The database file you wrote yesterday lives in
   a folder that is no longer the live build — so after your next `git push`, the app starts
   against an **empty database**. Orders, customers, invoices: gone.
2. **Hostinger's docs are explicit that `hbuilds/` is managed by deployments** and that files
   there are overwritten. Manual edits via File Manager, FTP, or SSH are "not supported."

For an e-commerce platform taking real orders, that is not an acceptable trade. **Move to a
server database before you deploy.** Hostinger's wizard supports Supabase (Postgres) and
MongoDB Atlas; for this schema, Postgres is the right fit.

The good news: the migration is small. The schema has no SQLite-specific features, and this
guide includes the exact steps.

---

## Step 0 — Generate a production session secret

The app **refuses to boot in production** if `SESSION_SECRET` is missing or still a
development placeholder. That guard is deliberate and you will hit it immediately if you skip
this step.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Save the output for Step 3. Never commit it.

---

## Step 1 — Move from SQLite to Postgres (Supabase)

### 1a. Create the database

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → Database → Connection string → URI**.
3. Copy the URI. It looks like:
   `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
4. Use the **connection pooler** URI (port `6543`) for a serverless/container host, or the
   direct connection (port `5432`) if you are on a persistent process. Hostinger Web Apps run
   a long-lived Node process, so either works — the pooler is the safer default.

### 1b. Change the Prisma provider

In `prisma/schema.prisma`, change the datasource:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

Everything else in the schema is portable. The one SQLite-ism already handled: every
"enum" column is a plain `String` with a quoted default, which is valid Postgres too.

### 1c. Push the schema and seed

Run these **locally**, pointing at Supabase:

```bash
export DATABASE_URL="postgresql://postgres.[ref]:[password]@...:6543/postgres"
npx prisma db push          # creates all 22 tables
npm run db:seed             # seeds the demo dataset
```

Confirm in the Supabase **Table Editor** that the tables and rows exist. Do this from your
machine, not on the host — it is far easier to debug here.

> **Do not leave the seed data in a live store.** `prisma/seed.js` creates demo customers,
> orders and invoices. Before you take real traffic, clear the demo records or re-seed with
> your own data. The seeded admin account is `admin@woohelperpro.com` / `WooHelper@2026` —
> **change that password immediately after your first login.**

---

## Step 2 — Connect the GitHub repository

Your code is already at `https://github.com/devspariqo/WooHelperPRO`.

1. In hPanel, open **Websites → Add Website**.
2. Choose **Node.js web app**.
3. Choose **Import Git repository** → **Connect with GitHub**, and authorise the Hostinger
   GitHub App for this repository.
4. Select `devspariqo/WooHelperPRO` and click **Deploy**.

Hostinger will auto-detect Express and pre-fill the settings.

---

## Step 3 — Confirm the deploy settings

Review these before clicking Deploy. The values below assume the Postgres migration above.

| Field | Value | Why |
|---|---|---|
| **Framework preset** | Express (auto-detected) | Falls back to **Other** if detection fails — that is fine, just fill the rest manually |
| **Branch** | `main` | Pushes here trigger a redeploy |
| **Node.js version** | **22** (default) | `package.json` declares `>=18`; 22 is the current default and matches local development |
| **Package manager** | npm | Detected from `package-lock.json` |
| **Build command** | `npm run build` | Runs `prisma generate` — see the note below |
| **Entry file** | `src/server.js` | Matches `package.json` `main` |
| **Output directory** | *(leave blank)* | This is a server app, not a static build |

### Why the build command matters

Prisma Client is **generated code**. It is written into `node_modules/.prisma/client`, which is
not committed to git. On a clean install the app would start with no client and crash on the
first database call with a confusing error.

To fix this, the repository now has:

```json
"postinstall": "prisma generate",
"build": "prisma generate"
```

`postinstall` covers a plain `npm install`; `build` covers hosts that run an explicit build
step. Setting **Build command** to `npm run build` above guarantees generation runs even if
the host installs with `--ignore-scripts`.

### Environment variables

Open **Environment variables** in the app dashboard and add these. Remember: keys must be
`A-Z`, `0-9`, `_` only, and variables are injected into **both build and runtime**.

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Supabase connection URI |
| `SESSION_SECRET` | the random string from Step 0 |
| `APP_URL` | `https://yourdomain.com` |
| `APP_NAME` | `WooHelperPro` |
| `ADMIN_EMAIL` | your real admin address |
| `ADMIN_PASSWORD` | a strong password — **not** the demo one |
| `SSLCOMMERZ_STORE_ID` | *(leave empty until you have live merchant credentials)* |
| `SSLCOMMERZ_STORE_PASSWORD` | *(leave empty)* |
| `SSLCOMMERZ_SANDBOX` | `true` until you go live, then `false` |
| `BKASH_APP_KEY` / `BKASH_APP_SECRET` | *(empty until configured)* |
| `BKASH_USERNAME` / `BKASH_PASSWORD` | *(empty)* |
| `BKASH_SANDBOX` | `true` |
| `BKASH_MERCHANT_NUMBER` | your real bKash number |
| `NAGAD_MERCHANT_NUMBER` | your real Nagad number |
| `ROCKET_MERCHANT_NUMBER` | your real Rocket number |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | your mail provider |

**Do not set `PORT`.** Hostinger injects it and the app reads `process.env.PORT` already.
Hardcoding it is the most common cause of "the process starts then immediately dies."

> You can bulk-import instead of typing each one: **Import .env** accepts an uploaded `.env`
> file. Build that file from `.env.example`, filling in real values — and never commit it.

Saving environment variables **triggers a redeploy**.

---

## Step 4 — Deploy and verify

Click **Deploy**. Then:

1. **Watch Build logs** for the `prisma generate` line and a successful finish.
2. Click the **Running** badge and open **Runtime Logs**. A green build with a dead process
   almost always means a missing env var or a bad port binding — the logs will say which.
3. Load `https://yourdomain.com/api/health`. You want `200` and a JSON body.
4. Load the home page, then `/packages`, then `/login`.

### Point your smoke test at production

The repository's own smoke suite works against any base URL:

```bash
BASE=https://yourdomain.com npm run smoke
```

You should see **73 pass / 0 fail**. It verifies the public, customer and admin surfaces, that
one customer cannot read another customer's records (404, not the data), that anonymous access
to `/admin` and `/account` redirects, and that malformed payment webhooks return 4xx rather
than 500.

### If the suite reports 302 on every authenticated route

That is almost always one of two things:

- **You are testing over plain HTTP.** In production the session cookie is set `Secure`, so a
  browser — and curl — will not send it over `http://`. Test over `https://`.
- **`SESSION_SECRET` changed** between deploys, invalidating every existing session. Sign in
  again; sessions do not survive a secret rotation.

Neither indicates a bug in the app. I verified the `Secure` behaviour locally: running the app
with `NODE_ENV=production` over HTTP reproduces exactly this pattern of 302s.

---

## Step 5 — After the first successful deploy

- [ ] **Change the admin password** if you seeded the demo account.
- [ ] **Remove demo data** — orders, invoices, customers from `prisma/seed.js`.
- [ ] **Set the real `APP_URL`** so absolute links and payment return URLs are correct.
- [ ] **Re-check payment return URLs** in the bKash / SSLCommerz merchant dashboards; they
      must point at your production domain, or the hosted checkout will bounce users to a
      `localhost` address.
- [ ] **Confirm email works** — place a test order and verify the notification arrives.
- [ ] **Turn off sandbox** (`SSLCOMMERZ_SANDBOX=false`, `BKASH_SANDBOX=false`) only once live
      credentials are in place and a real test transaction has succeeded.

---

## Redeploying

Push to `main` and Hostinger rebuilds automatically. Or use **Deployments → Redeploy**.

Two things to know:

- **Only the live build and one previous build are kept.** Rollback means pushing older code or
  re-uploading an older archive — there is no long history.
- **Do not hand-edit files on the server.** `hbuilds/` and `public_html` are overwritten on
  every deploy. Change the source and push. Configuration belongs in environment variables.

---

## Known limitations to plan around

These are honest gaps, not blockers, but you should know about them before launch.

**Sessions are stored in memory.** The app uses Express's default `MemoryStore`, so sessions
are lost on every restart and redeploy, and would not be shared across multiple instances.
For a single-instance app with rolling 14-day cookies this is survivable, but users will be
logged out more often than they expect. The fix is a persistent store — `connect-pg-simple`
on the Supabase database you already have, or Redis. That is a small, contained change to
`src/app.js`.

**No file uploads exist yet**, which is why the ephemeral filesystem is not a problem. If you
later add image uploads (portfolio thumbnails, blog covers), writing to `public/uploads` will
**not** work — those files vanish on redeploy. Use object storage (Supabase Storage or S3)
from the start rather than discovering this after a client uploads their logo.

**`multer` is listed in `dependencies` but never imported.** It is dead weight and will show up
in Hostinger's vulnerability scan. Remove it unless you are about to build uploads.

**Single instance.** Hostinger Web Apps runs one process. If you outgrow it, the in-memory
session store becomes a hard blocker, so do that migration before scaling out.

---

## Quick reference: the parts people get wrong

| Symptom | Cause | Fix |
|---|---|---|
| Build succeeds, process dies immediately | `PORT` hardcoded | Delete the `PORT` env var; let Hostinger inject it |
| `[FATAL] SESSION_SECRET is missing…` in logs | Placeholder or absent secret | Set a random `SESSION_SECRET` (Step 0) |
| `@prisma/client did not initialize yet` | Prisma Client not generated | Ensure Build command is `npm run build` |
| Every authed route 302s | Testing over HTTP, not HTTPS | Use `https://`; the cookie is `Secure` in prod |
| Database appears empty after a deploy | SQLite file lived in the old build dir | Migrate to Postgres (Step 1) |
| 403 after a redeploy | Stale `public_html/.htaccess` | Redeploy to regenerate it |
