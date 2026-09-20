# WooHelperPro

A full-stack agency platform for a Bangladesh-based **e-commerce website design service**.
Customers sign up, order a package, pay with bKash / Nagad / Rocket, and the agency builds
their website — with the whole delivery pipeline, recurring subscriptions, and back-office
operations managed from one admin panel.

Built as a single Node.js application with three separated surfaces:

| Surface | Path | Audience |
| --- | --- | --- |
| Public marketing site + checkout | `/` | Anonymous visitors |
| Customer dashboard | `/account` | Signed-in customers |
| Admin / operations panel | `/admin` | Staff (role-gated) |

---

## Stack

- **Node.js** 18+ (developed on 22) with **Express 4**, CommonJS
- **Prisma 5** ORM over **SQLite** (`prisma/schema.prisma`, 22 models)
- **EJS** templates with `express-ejs-layouts` — 72 views across three layouts
  (`public`, `auth`, `dashboard`)
- **Sessions** via `express-session` (cookie name `whp.sid`) + `connect-flash`
- **bcryptjs** password hashing (12 rounds), **Helmet** CSP, **express-rate-limit**
- **multer** uploads, **nodemailer** mail, **sharp** image processing

Payments are wallet-transfer based: bKash / Nagad / Rocket with SSLCommerz as the
card/bank gateway. Because bKash, Nagad and Rocket have **no recurring mandate API**,
subscription auto-renew is a *reminder*, not an automatic charge — the customer pays each
cycle and accounts verifies it.

---

## Getting started

```bash
npm install
cp .env.example .env      # then edit SESSION_SECRET at minimum
npm run setup             # db:push + db:seed
npm run dev               # http://localhost:3000
```

`npm run setup` creates the SQLite schema and seeds a full demo dataset
(services, packages, customers, orders, subscriptions, invoices, tickets, content).

### Seeded accounts

All demo passwords are printed by the seeder. Defaults with an unmodified `.env`:

| Role | Email | Password |
| --- | --- | --- |
| Super Admin | `admin@woohelperpro.com` | `WooHelper@2026` |
| Admin (finance) | `imran@woohelperpro.com` | `Demo@1234` |
| Manager | `nusrat@woohelperpro.com` | `Demo@1234` |
| Support | `farhana@woohelperpro.com` | `Demo@1234` |
| Staff | `tanvir@woohelperpro.com` | `Demo@1234` |
| Customer | `shahidul@fashionhub.com.bd` | `Demo@1234` |

Roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `STAFF`, `SUPPORT`, `CUSTOMER`.
Permissions are a data-driven matrix in `src/middleware/auth.js`, exposed to every view
as the `can('permissionName')` helper.

---

## What it does

### Customer journey
1. **Browse** services and packages (`/services`, `/packages`), with Bangla descriptions.
2. **Order** via `/order/checkout` — pick a package, describe the business, choose a
   district (all 64), pick one-time / monthly / yearly billing, optionally apply a coupon.
   Guest checkout is allowed and creates a lightweight account.
3. Placing the order **immediately creates a delivery project** with the standard 6-stage
   milestone pipeline and **raises an invoice**, so the customer can pay straight away.
4. **Pay** by manual wallet transfer, submitting the transaction ID from
   `/account/invoices/:id`.
5. **Track** progress, invoices, payments, subscriptions and support tickets from
   `/account`.

### Operations panel
- **Dashboard & reports** — revenue, outstanding balances, invoiced-vs-collected,
  breakdowns by district and service, top customers.
- **Orders** — a state machine (`PAID → IN_PROGRESS → … → COMPLETED`) that only offers
  legitimate next states; assignment, notes, milestones, delivery handover.
- **Services & packages** — full CRUD, category management, feature/exclusion lists,
  pricing per billing cycle.
- **Subscriptions** — lifecycle control (pause / resume / mark paid / expire / cancel),
  live renewal quote preview, add-ons, and a billing sweep (dry-run supported).
- **Invoices & payments** — invoice documents, a verification queue for submitted
  wallet payments, manual payment recording, refunds.
- **Users** — role assignment, KYC status, password resets, archived rather than deleted
  when financial history exists.
- **CRM** — lead pipeline with conversion, coupons, support tickets.
- **Content** — testimonials, portfolio, blog, FAQs.
- **Settings** — brand, contact, payment destinations, SEO, maintenance mode.

---

## Verification

Three tools ship with the project and all are wired into npm scripts.

```bash
npm run lint:views            # static analysis of every EJS view
npm run lint:views:selftest   # proves the analyzer can actually detect a fault
npm run lint:view <file>      # audit a single view and print what it requires
npm run smoke                 # end-to-end HTTP sweep (needs a running server)
```

### `npm run lint:views`

Compiles every template and extracts the exact set of names each view reads from its
locals, then diffs that against the globals injected in `src/app.js` plus the keys each
route actually passes to `res.render`. It reports any name a view needs that nothing
supplies.

This catches a bug class that is easy to miss by eye:

- a view referencing a local its route never passes (`sub` vs `subscription`)
- **the no-op guard** — `undefinedLocal || fallback`. The `||` does *not* save you: the
  identifier is resolved before the operator runs, so the template throws at render time.
  Only `typeof x !== 'undefined'` is safe, and the analyzer distinguishes the two,
  reporting `typeof`-guarded names separately as intentional optionals.

`npm run lint:views:selftest` plants a fake undefined local in a template and asserts the
analyzer detects it. **A clean run is only meaningful if the self-test passes** — during
development an earlier version of this analyzer reported all 56 views clean while being
completely blind to a planted fault, because it was scanning the wrong compiled output.
Run the self-test whenever you touch the analyzer.

### `npm run lint:view <file>`

The analyzer is also a CLI, but loading it runs the whole sweep and exits. `scripts/run-audit.js`
exposes the same machinery as a library so you can interrogate one template — the workflow
that actually localised the `paymentStatuses` bug:

```bash
npm run lint:view views/admin/orders/detail.ejs
# view          : views/admin/orders/detail.ejs
# required      : C, Math, Number, canDelete, csrfField, fmt, helpers, nextStatuses, ...
# typeof-guarded: (none)
```

All three modes are available:

```bash
node scripts/run-audit.js                   # full sweep (delegates to the analyzer)
node scripts/run-audit.js --selftest        # in-memory plant, exit code gates CI
node scripts/run-audit.js views/foo.ejs     # one view, prints its required locals
```

It also exports `auditSource()` for testing a template string with no file on disk:

```js
const { auditSource } = require('./scripts/run-audit');
const r = auditSource("<%- totallyBogus || 1 %>");
if (!r.names.has('totallyBogus')) throw new Error('detector is blind');
```

### `npm run smoke`

Boots no server of its own — point it at a running instance with `npm run dev` in another
terminal. It discovers the record IDs it needs from the database and logs itself in with
the seeded credentials, so it works on any freshly seeded instance with no manual setup.

It asserts four things beyond page rendering:

- **Cross-customer isolation** — requesting another customer's subscription / invoice /
  ticket must return **404**, not the record. This is the check that matters most.
- **Auth guards** — anonymous access to `/admin` and `/account` must redirect.
- **Webhook signature handling** — wrong-length and absent `verify_sign` values must return
  **4xx, never 5xx**. This guards a latent crash: `crypto.timingSafeEqual` throws
  `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on buffers of differing length, so a malformed IPN
  used to become a 500 — and gateways retry errored IPNs, so it became a retry loop.
- **Known redirects** — `/pricing` intentionally 301s to `/packages`.

> Note that the webhook assertions are only *logically* exercised when
> `SSLCOMMERZ_STORE_PASSWORD` is set. With no secret configured, `verifyWebhook` returns
> `false` at its first guard and the length comparison is never reached — so a live sweep
> against a default `.env` cannot see this bug class. To test it directly, inject the secret:
>
> ```bash
> SSLCOMMERZ_STORE_PASSWORD="testpw" node -e '
>   const gw = require("./src/services/paymentGateway.service");
>   console.log(gw.GATEWAYS.SSLCOMMERZ.verifyWebhook({
>     tran_id: "t", amount: "100", currency: "BDT", verify_sign: "short"
>   }));  // must be false, must not throw
> '
> ```

The script bypasses `http_proxy` for localhost. If your shell exports a proxy, curl would
otherwise route localhost through it and get a **502 Bad Gateway** that looks exactly like
the app being down. If you see a 502 from the preflight, that is what happened — the
message says so explicitly.

Also note: launching the server with `node src/server.js &` from a shell can die when the
shell exits. Use a real terminal, or `npm run dev`.

---

## Architecture notes

Several design decisions are load-bearing and worth knowing before you change things.

### Document numbering

Order, invoice, subscription and ticket numbers share a format:

```
WHP-ORD-2609-0042
    │   │    └── NNNN — a single GLOBAL counter per document kind
    │   └─────── YYMM — the month the document was raised
    └─────────── kind
```

**The NNNN suffix keeps climbing across months** — only the YYMM part changes. It is
therefore wrong to derive the next value from a per-month row *count*: as soon as an older
month holds a higher sequence than the current month's count, the computed number collides
with an existing row. Every one of these columns is `@unique`, so the collision surfaces as
a **500 on customer checkout**.

All four generators (`order.service.js`, `invoice.service.js`, `subscription.service.js`,
`ticket.service.js`) read the **highest existing number** via
`ids.nextSequenceFrom()` and retry on a `P2002` unique violation for concurrency safety.
If you add a fifth document type, follow that pattern — do not count rows.

### Money

- **VAT is applied after discount**, not before.
- An invoice's `amountPaid` is **derived from SUCCESS payments** and recomputed on every
  payment mutation — it is never hand-maintained. Invoice status follows from it
  (`PARTIALLY_PAID` only once paid exceeds zero but not the total).
- Marking an invoice `PAID` manually does *not* record a payment; the invoice detail screen
  says so explicitly. Recording money is a separate, audited action.
- Users, orders, packages and services with financial history are **archived, not
  deleted**.

### Orders and projects

`Order.serviceId` is a **scalar with no `service` relation** on the model. The service is
reached through the package (`package: { include: { service: true } }`). Querying
`Order` with a `service` include throws a `PrismaClientValidationError`.

### Enums

SQLite has no native enum, so all 22 models use `String` columns with quoted defaults.
The canonical value sets and their Bangla labels live in `src/config/constants.js` and are
exposed to every view as the `C` object (`C.ORDER_STATUS`, `C.DISTRICTS`, …).
**In a view, reference `C.X` directly** — `someStatuses || C.SOME_STATUS` will throw if
`someStatuses` was never passed, because the identifier resolves first.

`C.DISTRICTS` is an array of `[English, Bangla]` pairs, so consumers unwrap with
`Array.isArray(d) ? d[0] : d`.

### Templates

Globals injected in `src/app.js` and available in **every** view: `app`, `env`, `C`, `fmt`,
`json`, `helpers`, `t`, `settings`, `theme`, `lang`, `currentPath`, `query`, the flash
arrays (`success` / `error` / …), `csrfField`, `csrfToken`, `title`, `metaTitle`,
`metaDescription`, `bodyClass`, and — when signed in — `currentUser`, `can`, `isStaff`,
`isAdmin`.

Two things that bite:

- The signed-in user is **`currentUser`**, never `user`.
- Every POST form must include `<%- csrfField %>`. CSRF is a custom HMAC implementation,
  not a library default.
- **Views cannot reliably `require()` modules** — the call resolves against the EJS module
  rather than the project root and throws at render time. Pass what you need as a local.

---

## Configuration

All configuration is environment-driven; see `.env.example` for the annotated list.

| Area | Keys |
| --- | --- |
| Core | `NODE_ENV`, `PORT`, `APP_URL`, `APP_NAME`, `DATABASE_URL` |
| Sessions | `SESSION_SECRET` — **change this in production** |
| Admin bootstrap | `ADMIN_EMAIL`, `ADMIN_PASSWORD` |
| Gateways | `SSLCOMMERZ_*`, `BKASH_*` (each with a `*_SANDBOX` flag) |
| Manual wallets | `BKASH_/NAGAD_/ROCKET_MERCHANT_NUMBER` — shown on the payment page |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| Courier | `PATHAO_CLIENT_ID` / `_SECRET`, `STEADFAST_API_KEY` |
| Uploads | `MAX_UPLOAD_MB` |

Payment gateways and SMTP are **optional**. With no credentials the app still runs: it
falls back to honest manual wallet transfer, and the admin settings screen shows which
integrations are live. Nothing silently pretends to be configured.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with `--watch` |
| `npm start` | Production server |
| `npm run build` | `prisma generate` — generates the Prisma Client (also runs on `postinstall`) |
| `npm run db:push` | Push the Prisma schema to the database |
| `npm run db:seed` | Seed the demo dataset |
| `npm run db:reset` | Drop and recreate the database |
| `npm run db:provider <name>` | Switch the datasource between `sqlite` / `postgresql` / `mysql` |
| `npm run setup` | `db:push` + `db:seed` |
| `npm run smoke` | End-to-end HTTP sweep against a running server |
| `npm run lint:views` | Audit view/locals contracts |
| `npm run lint:views:selftest` | Prove the view auditor can detect faults |
| `npm run lint:view <file>` | Audit a single view and print its required locals |

> `npm run build` and `postinstall` both run `prisma generate`. Prisma Client is generated
> code — it lives in `node_modules/.prisma` and is not committed, so a fresh clone has no
> client until one of these runs. Without it the app crashes on the first query with
> `Cannot find module '.prisma/client/default'`.

---

## Switching to MySQL or Postgres

The schema targets SQLite for zero-setup local development. To move to a server database:

1. Switch the provider with the bundled script:
   ```bash
   npm run db:provider postgresql   # or: mysql
   npm run db:provider              # report the current provider
   ```
2. Point `DATABASE_URL` at the new server.
3. Re-run `npm run db:push` (or generate a migration).

Because SQLite lacks enums, the enum-typed columns are already plain `String`s, so the
schema needs no restructuring to move — only the provider and connection string. The schema
has been validated against both providers.

> **Deploying to Hostinger? Read [docs/DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md) first.**
> SQLite will not survive there: the host runs your app from a versioned build directory that
> is replaced on every deploy, so a database file written at runtime is lost on the next push.
> Postgres is required. That guide covers the migration, the Hostinger deploy settings, the
> environment variables, and the failure modes people hit.
