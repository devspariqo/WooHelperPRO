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
- **nodemailer** for outbound mail, **compression** for gzip, **multer** for uploads

### Media and uploads

The media library at `/admin/media` stores images on disk under `UPLOAD_DIR`
(`public/uploads/` by default) and records each one in the `MediaAsset` table.

Uploads are validated by **magic bytes, not by filename or client-supplied MIME type** — a
shell script renamed to `.png` and posted as `image/png` is rejected. Only PNG, JPEG, GIF,
WebP, AVIF and ICO are accepted; the stored extension is rewritten from the sniffed type, and
the on-disk name is random, so nothing about the path is attacker-controlled.

**SVG is deliberately not accepted.** It is XML and can carry `<script>`, which would execute
on your own origin. Place a custom SVG logo under `public/images/` by hand instead.

Image dimensions are read from the file header (PNG, GIF, WebP and JPEG parsed by hand — no
image library) so templates can emit `width`/`height` and avoid layout shift.

> **Uploading is a two-part flow.** The CSRF token must travel as an `X-CSRF-Token` header,
> not only in the form body: multer parses multipart bodies and runs *after* the CSRF
> middleware, so when CSRF checks `req.body` a multipart form's fields are not parsed yet and
> the token looks absent.

### Payment logos

`/admin/settings` → *Payment method logos* takes a URL per method (bKash, Nagad, Rocket,
SSLCommerz, card, bank, cash on delivery). Upload the image in the media library, paste its
URL. The `partials/payment-logos` partial renders only the methods that have a logo, so the
strip is never a row of broken images and never advertises a rail you do not accept. It
appears in the public footer on every page.

### SEO: sitemap, robots and performance

`/sitemap.xml` and `/robots.txt` are generated on request from the database, so publishing a
service or a blog post updates them immediately — no rebuild, no cache to bust.

- **sitemap.xml** lists the static pages plus published services, packages and blog posts,
  with `lastmod` from the row. Portfolio items are deliberately excluded: there is no
  `/portfolio/:slug` route, and a sitemap pointing at 404s is worse than one that omits them.
- **robots.txt** always disallows `/admin`, `/account`, `/api` and the auth/checkout paths
  regardless of configuration. Add extra paths one per line, or supply a completely custom
  file — which then replaces the generated one entirely, sitemap reference included.

Both are controlled from `/admin/settings` → *Search engines & crawling*. Responses are
gzipped, and uploaded media is served `immutable` for a year because its filename is unique
per upload.

### Mail

SMTP is configured in `/admin/settings` → *Email delivery (SMTP)*, stored in the database and
read **per send**, so fixing a wrong port takes effect on the next email without a restart.
Blank fields fall back to the `SMTP_*` environment variables. With no host configured at all,
messages are written to the server log instead of throwing, so the order flow stays testable
locally. *Send a test email* reports the real SMTP error rather than a generic failure.

Notifications are per-event and can be switched off individually: new order, payment awaiting
verification, new ticket and new enquiry go to the team; order received, status change and
payment confirmed go to the customer. Templates take their colours from the branding settings.

> Email HTML cannot use CSS variables, so every style is inlined and the brand colour is
> interpolated at build time. Keep new templates inline — most clients strip `<style>` blocks.

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

Permissions are a **data-driven matrix** (`PERMISSIONS`, 21 keys) in `src/middleware/auth.js`.
There are two consumers, and they must agree:

- `requirePermission('orders')` — route middleware. Returns 403 on a denied request.
- `can('orders')` — the view helper, exposed to every template. Hides UI the role cannot use.

Both resolve through the same `can(role, permission)` function, so there is exactly one
definition of what a permission means. If you add a permission, add it to the matrix — do not
sprinkle role comparisons through views or routes.

> **`can()` takes a PERMISSION name, not a role.** `can('orders')` is correct;
> `can('MANAGER')` is not. This was once implemented inline as a role comparison, so every
> `can('dashboard')`-style call evaluated `['dashboard'].includes('SUPER_ADMIN')` and returned
> false for everyone — which silently emptied the entire admin sidebar for every role, including
> super admin, while all routes kept returning 200. `npm run verify:sidebar` now guards this.

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
- **Settings** — see below.

### Site settings (`/admin/settings`)

One singleton row (`SiteSetting`, id `"singleton"`) drives the public identity. Every field is
editable at runtime and takes effect on the next page load — no rebuild, no redeploy.

| Section | Fields |
| --- | --- |
| Brand & contact | site name, tagline (EN/BN), support email/phone, WhatsApp, office address |
| Logo & favicon | logo URL, alt text, logo height (16–96px), favicon URL |
| Colours & fonts | primary / secondary / accent colour, heading + body font, plus Bangla heading/body fonts |
| Payment destinations | bKash / Nagad / Rocket numbers, bank details, VAT % |
| Search engine defaults | meta title, description, keywords, robots directive, social share image, X handle, Google Analytics ID, Search Console verification |
| General | timezone, default language, date format, footer text |
| Social profiles | Facebook, YouTube, LinkedIn |
| Availability | maintenance mode |

**How branding is applied.** The three layouts (`public`, `auth`, `dashboard`) build a Google
Fonts `<link>` from the configured families and inject the colours as CSS custom properties
(`--brand-600`, `--text`, `--accent-500`, `--font`, `--font-heading`) inside a `<style>` block.
Those override the compiled defaults in `public/css/site.css`, which is why a colour change
appears immediately. Leave the logo blank and the layouts fall back to the generated text
wordmark, so a fresh install never renders an empty brand.

**Two things worth knowing before you extend the form:**

- Colours are interpolated into a `<style>` block and font names into a URL query string, so both
  are **validated on save**: colours must be 3/6-digit hex, font names are stripped to
  `[A-Za-z0-9 -]`, and the Analytics ID to `[A-Za-z0-9-]`. An invalid colour falls back to the
  stored value rather than being written. If you add a field that reaches that `<style>` block,
  validate it the same way — otherwise you have a CSS-injection vector.
- The fallback settings object in `src/app.js` (used when the settings row cannot be read) must
  list **every** field the layouts interpolate. A missing key renders the literal string
  `undefined` into the CSS and breaks the whole page.

---

## Verification

Six tools ship with the project and all are wired into npm scripts. The first four need a
running server (`npm run dev` in another terminal); the lint tools do not.

```bash
npm run lint:views            # static analysis of every EJS view
npm run lint:views:selftest   # proves the analyzer can actually detect a fault
npm run lint:view <file>      # audit a single view and print what it requires
npm run smoke                 # end-to-end HTTP sweep across all three surfaces
npm run verify:admin          # every admin GET route, with real record IDs
npm run verify:admin:post     # admin form submissions, each self-reversing
npm run verify:sidebar        # sidebar links present/hidden per role
npm run verify:settings       # settings form -> database -> rendered HTML
```

`npm run verify:admin` walks all 35 admin GET routes using IDs pulled from the database, so no
route is ever tested against a fake record, and reports the status each route intended.

`npm run verify:admin:post` submits admin forms in a way that leaves the database exactly as it
found it — each action is performed twice (a toggle returns to its original state) or with the
value already in place. It also asserts that an admin POST without a CSRF token is rejected.

`npm run verify:settings` writes a distinctive colour, logo and font, confirms each one appears
in the rendered public HTML, checks that a CSS-injection attempt in a colour field is refused,
and then restores the original settings.

`npm run verify:sidebar` signs in as each of the five staff roles, reads the sidebar out of the
rendered `/admin` page, and compares it against the `PERMISSIONS` matrix — asserting both that
every entitled item is present **and** that nothing a role is not entitled to leaks through. It
then requests all 19 destinations as a super admin to confirm they resolve. The matrix is read
from `src/middleware/auth.js` at runtime, so the test cannot drift from the real policy.

> A 200 on `/admin` does **not** prove the admin UI works. The sidebar once rendered completely
> empty for every role — section headings with no links under them — while every route returned
> 200 and `npm run smoke` stayed green, because the bug was in a view helper rather than a route.
> That is the gap `verify:sidebar` exists to close.

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
| `npm run verify:admin` | Sweep every admin GET route with real record IDs |
| `npm run verify:admin:post` | Submit admin forms; each action self-reverses |
| `npm run verify:sidebar` | Sidebar links present/hidden per role vs the matrix |
| `npm run verify:settings` | Settings form round-trip into the rendered HTML |
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
> You need a server database — the account this project was built for uses **MySQL**
> (`npm run db:provider mysql`). Postgres works too; the schema needs no restructuring for
> either, because the enum-typed columns are already plain `String`s. That guide covers the
> migration, the Hostinger deploy settings, the environment variables, and the failure modes
> people hit.
