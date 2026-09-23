# Deploying WooHelperPro to Hostinger

**App URL:** https://woohelperpro.spariqo.com
**Repository:** https://github.com/devspariqo/WooHelperPRO
**Database:** `<DB-USER>` (MySQL) on `<DB-HOST>`

Everything below is specific to your account. Follow it in order.

---

## Step 0 — Generate a production session secret

The app **refuses to boot in production** if `SESSION_SECRET` is missing or still a
development placeholder. Do this first or the first deploy will fail on purpose.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Copy the output — you need it in Step 3.

---

## Step 1 — Your database credentials, and the `#` trap

You gave me:

| | Value |
|---|---|
| Database | `<DB-USER>` |
| User | `<DB-USER>` |
| Password | `<DB-PASSWORD>` |
| Server | `<DB-HOST>` |
| Port | `3306` |

### The password contains `#`, which must be URL-encoded

`#` starts a *fragment* in a URL. Paste the raw password into `DATABASE_URL` and the
connection string becomes **invalid** — I verified this: `new URL(...)` throws
`ERR_INVALID_URL` outright, and Prisma fails with `P1000 Authentication failed`.

```
WRONG:   mysql://<DB-USER>:<DB-PASSWORD>@<DB-HOST>:3306/<DB-USER>
RIGHT:   mysql://<DB-USER>:<URL-ENCODED-PASSWORD>@<DB-HOST>:3306/<DB-USER>
```

`#` becomes **`%23`**. Generate it yourself to be safe:

```bash
node -e "console.log(encodeURIComponent('<DB-PASSWORD>'))"
# -> <URL-ENCODED-PASSWORD>
```

## Step 2 — Your IP is not allowlisted for remote access

I tested the credentials from your machine. Both the **correct** password and a
**deliberately wrong** one returned the byte-identical error:

```
Access denied for user '<DB-USER>'@'<YOUR-PUBLIC-IP>' (using password: YES)
```

MySQL returns the same `ER_ACCESS_DENIED_ERROR` for a non-allowlisted IP as for a bad
password, so this does **not** mean your password is wrong. It means
`<YOUR-PUBLIC-IP>` — your public IP — is not in the allowlist. Databases are
`localhost`-only by default.

> **Your IP is dynamic.** MySQL saw `<YOUR-PUBLIC-IP>`, and seconds later `ipify` reported
> `<YOUR-IP-ROTATED>`. Allowlisting a single address will break the moment your ISP rotates
> it. See the two options below.

### You only need remote access for the one-time setup

The app itself connects from inside Hostinger, which needs no allowlist. Remote access is
only for running `db push` and `seed` from your laptop. **You have two options — pick one.**

#### Option A (recommended): run the setup on the server, skip remote access entirely

Deploy first (Steps 3–5), then run the setup through Hostinger's terminal or as a one-off
build command. Nothing needs to touch your local IP, and nothing breaks when your ISP
rotates it.

#### Option B: allowlist your IP, run setup locally

1. hPanel → **Databases** → **Remote MySQL**.
2. Add your current public IP (`https://api.ipify.org`).
3. Run the commands in Step 2b **within the same session**, and re-add your IP if your
   connection drops.

Whichever you pick, **do not** leave `%` (all hosts) in the allowlist after setup.

### Step 2b — Create the tables and seed (Option B path)

```bash
cd D:/SPECIAL/WooHelperPRO

# 1. Point at the database (note %23 -- see the encoding note above)
export DATABASE_URL="mysql://<DB-USER>:<URL-ENCODED-PASSWORD>@<DB-HOST>:3306/<DB-USER>"

# 2. Switch the datasource AND regenerate the client, in one step.
#    `auto` reads DATABASE_URL and picks the matching provider, so the schema and
#    the connection string cannot disagree.
npm run db:provider:auto

# 3. Create all 22 tables
npx prisma db push

# 4. Seed demo data
npm run db:seed
```

> **Why `auto` rather than a hardcoded `mysql`.** The provider used to be a manual
> local step, which meant that if anyone forgot it, the build generated a **SQLite**
> client against a **MySQL** database — a green build followed by a crash on the
> first query, on the server. `auto` derives the provider from the connection
> string, and `npm run build` now calls it, so the two cannot drift.

I verified all 22 tables generate valid MySQL DDL with `utf8mb4_unicode_ci` — correct for
Bangla text. `prisma/seed.js` uses only the Prisma Client API, so it is portable.

Confirm in hPanel → **Databases** → **phpMyAdmin** that 22 tables exist.

> **Do not launch with the seed data.** It creates demo customers, orders and invoices.
> Clear it before real traffic. There is also **no migration history** with `db push` —
> schema changes later will need `db push` again, or a switch to `prisma migrate`.

---

## Step 3 — Connect the repository

1. hPanel → **Websites** → **Add Website**.
2. Choose **Node.js web app**.
3. Choose **Import Git repository** → **Connect with GitHub**, and authorise the Hostinger
   GitHub App for `devspariqo/WooHelperPRO`.
4. Select the repo and continue.

---

## Step 4 — Deploy settings

| Field | Value |
|---|---|
| Framework preset | Express (auto-detected); **Other** is fine too |
| Branch | `main` |
| Node.js version | **22** |
| Package manager | npm |
| **Build command** | `npm run build` |
| **Output directory** | *(leave blank — server app)* |
| **Entry file** | `src/server.js` |

### Why `npm run build` is not optional

Prisma Client is **generated code**. It lives in `node_modules/.prisma`, which is not
committed to git, so a fresh install has no client and crashes on the first database call:

```
Cannot find module '.prisma/client/default'
```

`npm run build` runs `prisma generate` and fixes it. There is also a `postinstall` hook for
hosts that run a plain `npm install`. I verified both the failure and the fix by deleting
`node_modules/.prisma` and re-running the build.

---

## Step 5 — Environment variables

hPanel → your app → **Environment variables**. Add each one.

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://<DB-USER>:<URL-ENCODED-PASSWORD>@127.0.0.1:3306/<DB-USER>` |
| `SESSION_SECRET` | the random string from Step 0 |
| `APP_URL` | `https://woohelperpro.spariqo.com` |
| `APP_NAME` | `WooHelperPro` |
| `ADMIN_EMAIL` | your real admin email |
| `ADMIN_PASSWORD` | a strong password — **not** `WooHelper@2026` |
| `SSLCOMMERZ_STORE_ID` | *(empty for now)* |
| `SSLCOMMERZ_STORE_PASSWORD` | *(empty for now)* |
| `SSLCOMMERZ_SANDBOX` | `true` |
| `BKASH_APP_KEY` | *(empty)* |
| `BKASH_APP_SECRET` | *(empty)* |
| `BKASH_USERNAME` | *(empty)* |
| `BKASH_PASSWORD` | *(empty)* |
| `BKASH_SANDBOX` | `true` |
| `BKASH_MERCHANT_NUMBER` | your real bKash number |
| `NAGAD_MERCHANT_NUMBER` | your real Nagad number |
| `ROCKET_MERCHANT_NUMBER` | your real Rocket number |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | your mail provider |

### Two things that matter here

**1. Use `127.0.0.1`, not `localhost`, for the database host.**

This is Hostinger's documented gotcha for Node.js. PHP reaches MySQL over a local socket so
`localhost` works there, but Node connects over TCP and resolves `localhost` to the IPv6
loopback `::1` — which your database user is **not** granted. The result is:

```
Access denied for user '<DB-USER>'@'::1'
```

`127.0.0.1` forces IPv4 and works. Use `127.0.0.1` in the `DATABASE_URL` above.

**2. Do not set `PORT`.** Hostinger injects it and the app already reads
`process.env.PORT`. Hardcoding it is the single most common cause of "build succeeded but
the process died."

Saving variables **triggers a redeploy** — that is how you apply them.

---

## Step 6 — First deploy and verification

Click **Deploy**, then:

1. **Build logs** — look for `prisma generate` and a clean finish.
2. **Runtime Logs** (via the **Running** badge). A green build with a dead process is
   almost always a missing env var or a bad port, and the log names it.
3. Check the health endpoint:
   ```bash
   curl -s https://woohelperpro.spariqo.com/api/health
   ```
   Expect `200` and a JSON body.
4. Load the home page, then `/packages`, then `/login`.
5. Run the project's own smoke suite against production:
   ```bash
   BASE=https://woohelperpro.spariqo.com npm run smoke
   ```
   Expect **73 pass / 0 fail**.

### If the tables are missing (Option A path)

If you skipped Step 2b because your IP wasn't allowlisted, create the schema from the
server instead — in the app dashboard's terminal, or by temporarily setting the Build
command to:

```
npm run db:provider mysql && npx prisma generate && npx prisma db push && npm run db:seed && npm run build
```

Then set it back to `npm run build`. Existing rows are untouched, so it is safe to re-run.

---

## Step 7 — Post-deploy checklist

- [ ] **Change the admin password** if you seeded the demo account (`WooHelper@2026` is public on GitHub)
- [ ] **Delete the demo data** — orders, invoices, customers from `prisma/seed.js`
- [ ] Confirm `APP_URL` is `https://woohelperpro.spariqo.com` so links and payment returns are absolute
- [ ] **Repoint payment return URLs** in the bKash / SSLCommerz dashboards to
      `https://woohelperpro.spariqo.com` — they often default to `localhost` and will silently
      bounce customers
- [ ] Send a test email and confirm delivery
- [ ] Issue an SSL certificate for the domain (hPanel → **SSL**) and confirm HTTPS is forced
- [ ] Turn off sandbox mode only after one successful live transaction
- [ ] **Remove your IP from Remote MySQL** if you added it in Option B

---

## Known limitations

Not blockers, but plan around them.

**Sessions are stored in memory.** The app uses Express's default `MemoryStore`, so sessions
are lost on every restart and redeploy, and are not shared across instances. With 14-day
rolling cookies on a single instance this is survivable, but users will be logged out more
often than they expect. Fix: `connect-pg-simple`-style store for MySQL, or Redis. Small,
contained change to `src/app.js`.

**File uploads do NOT persist.** The media library writes to `public/uploads` (or
`UPLOAD_DIR`). Hostinger runs the app from a versioned build directory that is replaced on
every deploy, so **every uploaded image is lost on the next push** — logos, service card
art, portfolio covers, staff avatars, all of it. The database rows survive and keep pointing
at URLs that now 404.

This is not theoretical: the admin now has a media picker on the service, package,
portfolio, blog and user forms, so uploads are a normal part of using the panel.

Two options before you rely on it:

1. **Object storage** (correct fix). Point the media service at S3, Cloudflare R2 or
   Supabase Storage and store the returned absolute URL. The `url` column already holds an
   absolute URL, so nothing else has to change.
2. **An uploads directory outside the build tree.** Set `UPLOAD_DIR` to an absolute path
   outside `hbuilds/` (for example under `~/uploads`) and symlink it into `public_html`.
   Survives deploys, but it is outside the panel's managed area and you own the backups.

Until one of those is in place, treat every uploaded image as temporary. The bundled demo
artwork under `public/images/demo/` is committed to the repo and is therefore safe.

**MySQL index note.** Prisma generated `VARCHAR(191)` for indexed string columns, which is
required for `utf8mb4` compatibility on MySQL 5.7 and harmless on 8.x. Your account's
version handles this correctly.

**Single instance.** If you outgrow one process, the in-memory session store becomes a hard
blocker — do that migration before scaling out.

---

## Redeploying

Push to `main` and Hostinger rebuilds automatically.

- Only the live build and **one previous** are kept. Rollback means pushing older code.
- **Never hand-edit files on the server.** `hbuilds/` and `public_html` are overwritten on
  every deploy. Change the source and push; configuration goes in environment variables.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `P1000 Authentication failed` | Password `#` not encoded | Use `<URL-ENCODED-PASSWORD>` (`%23`) |
| `Access denied ...@'::1'` | `localhost` resolves to IPv6 | Use `127.0.0.1` as DB host |
| `Access denied ...@'<your-ip>'` | IP not allowlisted (same error as a bad password) | hPanel → Remote MySQL, or use Option A |
| Build green, process dies | `PORT` set manually | Delete the `PORT` env var |
| `Cannot find module '.prisma/client/default'` | Client not generated | Build command must be `npm run build` |
| Client generated for the wrong database (queries fail on a MySQL URL) | Provider left at `sqlite` | `npm run build` now derives it from `DATABASE_URL`; check the build log for `DATABASE_URL implies provider:` |
| `[FATAL] SESSION_SECRET is missing…` | Placeholder/absent secret | Set a random `SESSION_SECRET` |
| Every authed route 302s | Testing over HTTP; the cookie is `Secure` in prod | Test over `https://` |
| Could not connect at the remote hostname from the app | Used the remote host instead of loopback | Use `127.0.0.1` inside Hostinger |
| 403 right after a redeploy | Stale `public_html/.htaccess` | Redeploy to regenerate it |

---

## Security note

You shared the database password in plain text. It is now in this file and in your chat
history. It is **not** in the git repository (`.env`, `*.db` and the agent workspace are all
gitignored), but consider:

- Rotating it after setup (hPanel → **Databases** → **MySQL Users** → **Change Password**),
  then updating `DATABASE_URL` in the app's environment variables.
- Never committing `.env`. If you ever paste a secret into a committed file, rotate it —
  removing the file later does not remove it from git history.
