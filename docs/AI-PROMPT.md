# WooHelperPro — AI Agent Brief

> **What this file is.** A self-contained specification of the WooHelperPro codebase, written to be
> pasted into an AI coding agent (Claude Code, Cursor, Copilot Workspace, Codex, WorkBuddy, …) as
> the opening message of a session. It is the context an agent needs to make correct changes
> *without* rediscovering the architecture from scratch and without re-introducing bugs that were
> already found and fixed here.
>
> **Every fact below was read from the source**, not from the README. Where the README disagrees
> with the code, the code wins and the disagreement is called out in
> [§12 Known drift](#12-known-drift-read-this-before-trusting-the-readme).

---

## How to use this file

Pick the block that matches your task. Do not paste the whole document every time — length dilutes
instruction-following. The **full brief** lives in §1–§11; §12–§14 are appendices.

| Task | Paste |
| --- | --- |
| Any change to routes, views, services, or the schema | §0 Core rules + §1–§8 |
| Money, invoicing, subscriptions, or document numbers | §0 + §4 + §5 |
| A bug fix | §0 + §9 (invariants) + the relevant section |
| Deploying or changing configuration | §0 + §10 + §11 |
| Onboarding a new agent to the repo | the whole document |

---

## 0. Core rules — read before writing a single line

These are the rules that, when broken, produce a 500 in production or silently corrupt financial
data. They are ordered by how often they have actually bitten.

1. **The signed-in user is `currentUser`, never `user`.** Views and routes both. `user` is not in
   scope.
2. **Every POST form needs `<%- csrfField %>`.** CSRF is a custom HMAC implementation in
   `src/middleware/csrf.js`, not `csurf`. Omitting the field yields a 403.
3. **Views cannot reliably `require()`.** In EJS the call resolves against the EJS module rather
   than the project root. Pass what you need as a local. (There are currently **zero** `require(`
   calls inside `views/` — verify this stays true with `grep -rn "require(" views/`.)
4. **Never write `undefinedLocal || fallback` in a template.** The identifier is resolved *before*
   the `||` runs, so this throws identically to a bare reference. Only
   `typeof x !== 'undefined'` is safe. This is the "no-op guard" and the project's own auditor
   reports the two cases separately.
5. **SQLite has no enum type.** All 22 models use `String` columns with quoted defaults. The
   canonical value sets live in `src/config/constants.js` and reach views as `C`. In a template
   reference `C.SOME_STATUS` directly.
6. **Document numbers come from the highest existing number, never a row count.** See §4.1.
7. **VAT is applied after the discount**, not before. See §5.
8. **Money columns are `Float`, not `Decimal`.** Do not "fix" this without migrating existing rows
   and the `fmt.bdt` formatter together.
9. **`amountPaid` is derived from `SUCCESS` payments**, recomputed on every payment mutation. Never
   hand-maintain it.
10. **Records with financial history are archived, not deleted.** `User`, `Order`, `Package`,
    `Service`.
11. **Guest checkout creates a real `User` row** before the order exists. There is no anonymous
    order path.
12. **Run `npm run lint:views:selftest` before trusting `npm run lint:views`.** See §9.3.

---

## 1. What the product is

WooHelperPro is a **full-stack agency platform** for a Bangladesh-based e-commerce website design
service. The business model: a customer buys a build package, WooHelperPro builds the site, and the
customer optionally subscribes monthly or yearly for hosting, maintenance and support.

It is a **service-delivery platform with billing**, not a product storefront. There is no cart, no
product SKU, no shipping. The analogue in the BD market is storex.com.bd / uddoktaecommerce.com.

Three surfaces, separated by path and by audience:

| Surface | Path prefix | Audience |
| --- | --- | --- |
| Public marketing site + checkout | `/` | Anonymous visitors, guests |
| Customer dashboard | `/account` | Signed-in `CUSTOMER` |
| Admin / operations panel | `/admin` | Staff (role- and permission-gated) |

Plus two cross-cutting surfaces: `/api/*` (JSON, used by the checkout for live quoting) and
`/payments/*` (gateway callbacks and webhooks).

---

## 2. Stack and constraints

**Locked in — do not substitute without asking:**

- **Node.js >= 18** (developed on 22). `engines.node` is `>=18`.
- **Express 4** (`^4.21.2`), **CommonJS** (`"type": "commonjs"`). Not ESM. Not Express 5.
- **Prisma 5** (`^5.22.0`) with `prisma-client-js`.
- **EJS 3** + **express-ejs-layouts** (`^2.5.1`).
- **express-session** + **connect-flash**.
- **bcryptjs** (12 rounds) — *not* `bcrypt`, so there is no native build step.
- **Helmet**, **express-rate-limit**, **morgan**, **method-override**, **cookie-parser**, **dotenv**,
  **nanoid**.
- **nodemailer** is a dependency but mail is best-effort and optional.

**Deliberately absent:** TypeScript, a bundler, React/Vue, `multer`, `sharp`, any test framework
other than the bespoke scripts in `./scripts`. A fresh clone must run with `npm install` and nothing
else — no native compilation, no Python, no build toolchain.

**Dependency count: 16 runtime.** Keep it that way. Every addition is a deployment liability on
shared hosting.

---

## 3. Repository layout

```
.
├── prisma/
│   ├── schema.prisma          # 22 models, 0 enums, 581 lines
│   ├── seed.js                # idempotent demo dataset (deterministic PRNG)
│   └── woohelperpro.db        # SQLite file (gitignored in real use)
├── public/                    # static assets (css, js, images, uploads)
├── scripts/
│   ├── audit-view-locals.js   # the view/locals analyser  → npm run lint:views
│   ├── run-audit.js           # CLI + library wrapper      → npm run lint:view
│   ├── smoke-test.sh          # end-to-end HTTP sweep      → npm run smoke
│   ├── reset-db.js            # drop + recreate
│   ├── set-db-provider.js     # sqlite | postgresql | mysql
│   └── make-db-url.js         # connection-string helper
├── src/
│   ├── server.js              # entrypoint (package.json "main")
│   ├── app.js                 # createApp() — the whole Express wiring
│   ├── config/
│   │   ├── index.js           # env parsing + the production boot guard
│   │   ├── constants.js       # all value sets + Bangla labels
│   │   └── prisma.js          # shared PrismaClient singleton
│   ├── middleware/
│   │   ├── auth.js            # loadUser, guards, PERMISSIONS matrix, can()
│   │   ├── csrf.js            # custom HMAC synchronizer token
│   │   └── …                  # rate limiters, error handling
│   ├── routes/
│   │   ├── index.js           # mount order — load-bearing, see below
│   │   ├── public.routes.js   # 16 route files total
│   │   ├── auth.routes.js
│   │   ├── account.routes.js
│   │   ├── payment.routes.js
│   │   ├── api.routes.js
│   │   └── admin/             # index.js + 9 sub-routers
│   ├── services/              # 9 business-logic modules
│   └── utils/                 # ids.js, format.js, security.js
└── views/                     # 72 .ejs files across 3 layouts
    ├── layouts/               # public.ejs, auth.ejs, dashboard.ejs
    ├── partials/              # includes + helpers.js
    ├── public/                # marketing + checkout + legal
    ├── auth/
    ├── account/
    ├── admin/                 # 13 subdirectories
    └── errors/
```

**Verified counts** (re-check with `find`/`grep -c` rather than trusting this table):

| Thing | Count |
| --- | --- |
| Prisma models | 22 |
| Native enums | **0** |
| EJS views | 72 |
| Layouts | 3 |
| Route files | 16 (incl. 9 admin sub-routers) |
| Service modules | 9 |
| JS files under `src/` | 37 |
| Runtime dependencies | 16 |

### 3.1 Middleware order in `src/app.js` — do not reorder casually

```
trust proxy (1)  →  helmet  →  morgan  →  urlencoded/json (2mb)
  →  methodOverride('_method')  →  cookieParser  →  static (30d in prod)
  →  session (rolling, sameSite lax, secure in prod, name whp.sid)
  →  flash  →  csrf  →  globalLimiter
  →  locals middleware  →  loadUser  →  routes
```

`app.set('trust proxy', 1)` is required because Hostinger/Nginx terminates TLS in front of the Node
process. Without it the `secure` session cookie is never set and logins silently fail in production.

`loadUser` runs **after** the locals middleware and **re-reads the user from the DB on every
request**. It destroys the session for `SUSPENDED`/`INACTIVE` users. This is intentional: it means a
role change or suspension takes effect on the next request rather than at next login.

### 3.2 Route mount order in `src/routes/index.js`

```
/api/health            (probe, does SELECT 1)
/payments              (callback + webhooks — must precede csrf-exempt expectations)
/api                   (JSON)
/                      (public marketing + checkout + auth)
/account               (requireAuth + requireCustomer)
/admin                 (requireStaff at router level)
/                      (public fallback — mounted LAST)
```

The public router is mounted twice, and the second mount is last on purpose. Do not "tidy" this into
a single mount without checking the fallback behaviour.

`/admin/*` is mounted with `router.use(requireStaff)` on its index router, so **every** admin route
inherits the staff check. Sub-routers add `requirePermission('x')` on top.

**Structural gotcha:** none of the 9 admin sub-routers uses `router.use('/prefix', …)`. They are all
mounted at `/` and contribute their path segments through literal route strings (`router.get('/users',
…)`). The comments in `admin/index.js` describe the resulting path space, not mounts. If you add a
sub-router, mount it at `/` and write full literal paths.

Also: `'/new'` is declared **before** the `/:id` catch-all in the files that have both. Preserve
that ordering.

---

## 4. Data model

`prisma/schema.prisma` — 22 models, **0 native enums** (SQLite has none). Every "enum" column is a
`String` with a quoted default. Bilingual pairs (`name` / `nameBn`) are pervasive. JSON arrays are
stored as `String @default("[]")`.

### 4.1 The document-numbering scheme — get this right

Order, invoice, subscription and ticket numbers share a format:

```
WHP-ORD-2609-0042
    │   │    └── NNNN — a single GLOBAL counter per document kind
    │   └─────── YYMM — the month the document was raised
    └─────────── kind
```

Implemented in `src/utils/ids.js`:

```js
const PREFIX = 'WHP';
build(kind, sequence)                  // → WHP-KIND-YYMM-NNNN
sequenceOf(number)                     // parses /-(\d+)\s*$/
nextSequenceFrom(highestExisting)      // ← the correct primitive
nextSequence                            // @deprecated — see below
```

**The NNNN suffix keeps climbing across months.** Only the YYMM part rolls over. Therefore deriving
the next value from a *per-month row count* is wrong: as soon as an older month holds a higher
sequence than the current month's count, the computed number collides with an existing row. Every
one of these columns is `@unique`, so the collision surfaces as a **500 on customer checkout** — a
production-visible failure on the highest-traffic path.

All four generators read the **highest existing number** via `ids.nextSequenceFrom()` and retry on a
`P2002` unique violation:

| Generator | File | Retry |
| --- | --- | --- |
| `orderNumber` | `order.service.js` → `createOrderWithNumberRetry` | 5 attempts, `err.meta.target.includes('orderNumber')` |
| `subscriptionNumber` | `subscription.service.js` | 5 attempts |
| `invoiceNumber` | `invoice.service.js` | same pattern |
| `ticketNumber` | `ticket.service.js` | same pattern |

`nextSequence` is marked `@deprecated` in the source with the collision explanation attached. **Do
not call it. Do not add a fifth document type by counting rows.**

Note that the max-read uses `orderBy: { orderNumber: 'desc' }` — string ordering works here only
because the YYMM prefix is fixed-width. Keep it that way.

### 4.2 Model map

| Model | Notes |
| --- | --- |
| `User` | `role` default `CUSTOMER`, `status` default `ACTIVE`, `kycStatus` default `NOT_SUBMITTED`, `passwordHash` (bcryptjs, 12 rounds). Self-relations to `Project` (owner + `ProjectManager`). |
| `ClientNote` | Staff-only notes about a customer. `onDelete: Cascade` from `User`. |
| `ActivityLog` | Audit trail. `user` relation is `onDelete: SetNull` so the log survives user deletion. |
| `ServiceCategory` | Bilingual, `slug` unique, `icon` default `"layout"`, `sortOrder`. |
| `Service` | Bilingual title/desc, `features`/`featuresBn` as JSON strings, `basePrice Float`, `deliveryDays`, `status` default `ACTIVE`, SEO fields. |
| `Package` | The sellable unit. `price` (one-time BDT), `monthlyPrice`, `yearlyPrice`, `setupFee`, `discountPercent`, `tier`, `billingCycle`, `features`/`excluded` as JSON, plus limits: `revisions`, `deliveryDays`, `supportMonths`, `hostingMonths`, `pagesIncluded`, `productsLimit` (0 = unlimited), `staffLimit`. |
| `Order` | See §4.3 — the richest model. |
| `Subscription` | `billingCycle` default `MONTHLY`, `autoRenew` default `true`, `currentPeriodStart/End`, `gracePeriodDays` default 7, `cancelledAt` / `cancelReason` lifecycle fields. |
| `SubscriptionAddon` | Extra line items on a subscription, `cycle` + `quantity`. |
| `Invoice` | `status` default `DRAFT`, `amountPaid` derived, `dueDate` required, `vatNumber`. Parent of `Payment[]`. |
| `Payment` | `reference` unique, `method` default `MANUAL`, `direction` default `INBOUND`, `status` default `PENDING`, `verifiedById`/`verifiedAt`, `gatewayPayload` (raw JSON string). |
| `Project` | `orderId` is `@unique` — exactly one project per order. `progress Int`, `currentStage`, `managerId` (`ProjectManager` relation), `stagingUrl`/`liveUrl`/`repoUrl`. |
| `ProjectMilestone` | The 6-stage delivery pipeline. `isDone` + `completedAt`, `sortOrder`. |
| `Coupon` | `discountType` `PERCENT`\|`FIXED`, `appliesTo` `ALL`\|`SERVICE`\|`PACKAGE`\|`SUBSCRIPTION`, `minOrder`, `maxUses` (0 = unlimited), `usedCount`. |
| `Ticket` | `ticketNumber` unique, `category` default `GENERAL`, `priority` default `NORMAL`, `status` default `OPEN`. |
| `TicketReply` | `isStaff Boolean` distinguishes agent from customer in the thread. |
| `Testimonial` | `rating Int` default 5, `isApproved` default **false** (moderated), `isFeatured`. |
| `PortfolioItem` | `slug` unique, `results`, `techStack`, `isPublished` default true. |
| `BlogPost` | `status` default `DRAFT`, `views Int`, `tags` JSON string, `publishedAt`. |
| `Faq` | `category` default `GENERAL`, `sortOrder`, `isActive`. |
| `Lead` | Contact-form capture. `status` default `NEW`, `source` default `WEBSITE`, `followUpAt`. Indexed on `status`. |
| `SiteSetting` | `id @default("singleton")` — a single row the admin edits. Holds brand, contact, the three wallet numbers, `bankDetails`, `vatPercent` default **5**, `maintenanceMode`, SEO defaults, social URLs. |

### 4.3 `Order` — the model with the sharp edges

- **`serviceId` is a scalar with no `service` relation.** The service is reached through the package:
  `package: { include: { service: true } }`. Querying `Order` with a `service` include throws a
  `PrismaClientValidationError`. This is the single most likely thing to trip up a new agent.
- Financial columns: `subtotal`, `discount`, `tax`, `total`, `paidAmount`, `advancePaid`, `currency`
  (default `BDT`).
- Rich intake fields, all optional: `projectName`, `projectType`, `businessName`, `businessType`,
  `websiteGoal`, `referenceUrls`, `selectedPages` (JSON), `domainName`, `hostingChoice`,
  `preferredColors`, `brandNotes`, `contactPerson/Phone/Email`, `district`, `billingAddress`.
- Status fields: `status` default `PENDING`, `paymentStatus` default `UNPAID`, `priority` default
  `NORMAL`.
- Relations: `user` (Cascade), `package` (SetNull), `project` (one-to-one), `invoices[]`,
  `payments[]`, `milestones[]`.

### 4.4 Value sets

Canonical value sets live in `src/config/constants.js` and are injected into every view as `C`.

| Key | Kind | Size |
| --- | --- | --- |
| `ROLES` / `ROLES_BN` | object | 6 — `SUPER_ADMIN ADMIN MANAGER STAFF SUPPORT CUSTOMER` |
| `USER_STATUS` | object | 4 — `ACTIVE PENDING INACTIVE SUSPENDED` |
| `KYC_STATUS` | object | 4 — `NOT_SUBMITTED PENDING VERIFIED REJECTED` |
| `ORDER_STATUS` | object | 12 — `PENDING AWAITING_PAYMENT PAYMENT_VERIFIED IN_REVIEW IN_PROGRESS CLIENT_REVIEW REVISION COMPLETED` + 2 |
| `PAYMENT_STATUS` | object | 5 — `UNPAID PARTIAL PAID FAILED REFUNDED` |
| `SUBSCRIPTION_STATUS` | object | 6 — `TRIALING ACTIVE PAST_DUE PAUSED CANCELLED EXPIRED` |
| `INVOICE_STATUS` | object | 7 — `DRAFT SENT PARTIALLY_PAID PAID OVERDUE VOID REFUNDED` |
| `TICKET_STATUS` | object | 5 — `OPEN IN_PROGRESS WAITING_CUSTOMER RESOLVED CLOSED` |
| `PROJECT_STATUS` | object | 10 — `NOT_STARTED DESIGNING DEVELOPMENT CLIENT_REVIEW REVISION TESTING LAUNCHED MAINTENANCE` + 2, each carrying a `progress` value |
| `BILLING_CYCLE` | object | 5 — `ONE_TIME MONTHLY QUARTERLY HALF_YEARLY YEARLY` |
| `PAYMENT_METHOD` | object | 10 — `BKASH NAGAD ROCKET SSLCOMMERZ UPAY SURECASH BANK_TRANSFER CASH` + 2 |
| `PACKAGE_TIER` | object | 6 — `STARTER BASIC PROFESSIONAL BUSINESS ENTERPRISE CUSTOM` |
| `LEAD_STATUS` | object | 5 — `NEW CONTACTED QUALIFIED CONVERTED LOST` |
| `DISTRICTS` | array | **64** — `[English, Bangla]` pairs |
| `BUSINESS_TYPES` | array | 16 |
| `TICKET_CATEGORIES` | array | 8 |
| `SUPPORT_ADDONS` | array | 6 — `{name, nameBn, price, cycle}` |

`C.DISTRICTS` is an array of pairs, so consumers must unwrap:
`Array.isArray(d) ? d[0] : d`.

---

## 5. Money — the order of operations

`src/services/pricing.service.js` is the single source of truth. **The order is:**

```
subtotal  →  coupon discount  →  VAT on the DISCOUNTED amount  →  total
```

VAT comes from `SiteSetting.vatPercent` (default **5**). Applying VAT to the pre-discount subtotal is
a bug, not a rounding preference.

Public surface:

| Function | Purpose |
| --- | --- |
| `evaluateCoupon(code, ctx)` | Returns `{valid, reason, discount, coupon}` with **8 distinct rejection reasons** (expired, inactive, min-order not met, usage cap reached, wrong `appliesTo`, …). |
| `quotePackage({packageId, couponCode, paymentMode})` | `paymentMode` ∈ `one_time` \| `monthly` \| `yearly`. Returns an itemised `lineItems` array. |
| `quoteRenewal(subscription)` | Renewal quote; **includes addons**. |
| `quoteCustom(...)` | Ad-hoc quoting for custom scopes. |

Other money rules:

- **`Invoice.amountPaid` is derived from `SUCCESS` payments** and recomputed on every payment
  mutation. Invoice status follows: `PARTIALLY_PAID` only once paid exceeds zero but not the total.
- **Marking an invoice `PAID` manually does not record a payment.** The invoice detail screen says so
  explicitly in the UI. Recording money is a separate, audited action.
- `Order.status` is set at creation time by `order.service.js`:
  `Number(total) > 0 ? 'AWAITING_PAYMENT' : 'IN_REVIEW'`.
- `applyPaymentToOrder` auto-advances the order to `PAYMENT_VERIFIED` once fully paid.
- `revenueBetween(from, to)` is the reporting primitive for the dashboard and `/admin/reports`.

Formatting lives in `src/utils/format.js` and is injected as `fmt`:
`bdt number date datetime relative daysUntil daysBetween addMonths slugify initials percentChange
truncate maskPhone currency`.

---

## 6. Orders, projects and subscriptions

### 6.1 The order state machine

`order.service.js` exports a `TRANSITIONS` map with `canTransition(from, to)` and `allowedNext(from)`.
The UI renders only legitimate next states — there is no free-form status dropdown. Preserve this:
a status you can set arbitrarily is a status that will be set wrong.

`updateStatus` also runs a `projectSync` map so the `Project` tracker stays in step with the order.

Placing an order does three things atomically as far as the caller is concerned:

1. Creates the `Order` with a retried unique number.
2. Creates the `Project` with `defaultMilestones()` — **6 stages**.
3. Raises the `Invoice`, so the customer can pay immediately.

### 6.2 Subscription lifecycle

`subscription.service.js`:

```js
const CYCLE_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
```

- `createSubscription` wraps `createSubscriptionOnce` in a **5-attempt `P2002` retry**.
- `runBillingSweep({ dryRun })` is the time-based state machine:
  - `TRIALING` → `ACTIVE` when the trial ends
  - `ACTIVE` → `PAST_DUE` when past `currentPeriodEnd + gracePeriodDays`
  - `PAST_DUE` → `EXPIRED` when past **2×** grace
  - Returns a summary object; **`dryRun: true` must stay supported** — it is how you preview a sweep
    on live data.
- `renewalsDue(days = 14)` feeds the dashboard's renewal widget and the reminder emails.

**Auto-renew is a reminder, not a charge.** bKash, Nagad and Rocket expose **no recurring mandate
API**. `autoRenew: true` means the platform reminds the customer and accounts verifies the transfer
each cycle. Never implement a "charge the saved wallet" path — the capability does not exist on the
rail. This is the single most important product honesty constraint in the codebase.

---

## 7. Payments

`src/services/paymentGateway.service.js` exposes a uniform adapter surface over five gateways:

```js
isConfigured()          // are credentials present?
buildRedirect(payment)  // → { mode, url, … }
instructions()          // → what to show the customer
```

Gateways: **bKash, Nagad, Rocket, SSLCommerz, bank transfer.**

**The contract that matters:** an unconfigured gateway returns `{ mode: 'manual' }` rather than
faking a charge. With no credentials in `.env` the app still runs end to end, falling back to honest
manual wallet transfer, and the admin settings screen shows which integrations are live. Nothing
silently pretends to be configured. Do not break this.

Wallet numbers shown to the customer come from `SiteSetting` (`bkashNumber`, `nagadNumber`,
`rocketNumber`, `bankDetails`), which the admin edits — not from the env vars. The env vars exist as
seeds/fallbacks.

### 7.1 Webhook verification — the fixed bug

`verifyWebhook` for SSLCommerz:

```js
const expected = crypto.createHash('md5')
  .update(`${secret}|${payload.tran_id}|${payload.amount}|${payload.currency}`).digest('hex');
const supplied = payload.verify_sign || payload.verify_key;
if (!supplied) return false;
const a = Buffer.from(expected);
const b = Buffer.from(String(supplied));
if (a.length !== b.length) return false;   // ← this line is the fix
return crypto.timingSafeEqual(a, b);
```

**Why the length guard exists.** `crypto.timingSafeEqual` throws
`ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` when the buffers differ in length. Before the guard, a
malformed `verify_sign` arriving from the network became a **500** — and real gateways retry errored
IPNs, so a single malformed request became an endless retry loop. Lengths are public information, so
comparing them first leaks nothing.

The same guard is present in `src/middleware/csrf.js`:

```js
if (bufA.length !== bufB.length || bufA.length === 0) return false;
```

**Any new `timingSafeEqual` call site in this codebase must have a length guard.** This has now been
the same bug twice.

---

## 8. Security

### 8.1 Sessions and the production boot guard

`whp.sid`, `maxAge` 14 days, `rolling: true`, `sameSite: 'lax'`, `secure: config.isProd`.

`src/config/index.js` refuses to boot in production with a placeholder secret:

```js
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-me')
    || process.env.SESSION_SECRET.includes('dev-only'))) {
  console.error('\n[FATAL] SESSION_SECRET is missing or still set to a development placeholder.');
  console.error('        Set a long random value in .env before running in production.\n');
  process.exit(1);
}
```

Note the check is a **substring** test, not equality — so `change-me-please` is also rejected. To
generate a valid secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

That yields exactly **64 chars** of `[A-Za-z0-9_-]`, so no `.env` quoting is needed — no `"`, `'`,
`$`, backtick, space or `#` can occur.

### 8.2 CSRF

`src/middleware/csrf.js` — a hand-rolled **synchronizer token**, replacing the deprecated `csurf`.

- Token = `HMAC-SHA256(sessionID, csrfSecret)`.
- `SAFE_METHODS = ['GET','HEAD','OPTIONS']`.
- `EXEMPT_PATHS = ['/payments/webhook/sslcommerz', '/payments/webhook/bkash', '/api/health']` —
  webhooks and the health probe cannot carry a browser session token.
- Injected into every response as `csrfField` (the `<input type="hidden" name="_csrf" …>` string) and
  `csrfToken`.
- `csrfField` comes from this middleware, **not** from `views/partials/helpers.js` — that module only
  exports `statusBadge`, `statusBadgeT`, `progressBar`, `emptyState`.

If you add a webhook endpoint, add its path to `EXEMPT_PATHS` *and* give it its own signature
verification. An exempt path with no signature check is an unauthenticated write endpoint.

### 8.3 Roles and permissions

Six roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `STAFF`, `SUPPORT`, `CUSTOMER`.

`src/middleware/auth.js` exports guards `requireAuth`, `requireCustomer` (redirects staff to
`/admin`), `requireRole(...roles)`, `requireStaff`, `requireAdmin`, `requireSuperAdmin`,
`requirePermission(permission)`, `redirectIfAuthed`.

Permissions are a **data-driven matrix** (`PERMISSIONS`) — 21 keys, exposed to every view as
`can('permission')`:

```
dashboard  users  usersDelete  roles  services  packages  orders  ordersDelete
projects  subscriptions  invoices  payments  coupons  tickets  leads  content
testimonials  portfolio  settings  activity  reports
```

Add a permission by adding a matrix key, not by sprinkling role checks. Note that the admin
sub-routers use `requirePermission` almost exclusively; `requireAdmin`/`requireSuperAdmin` appear
inline only where a super-admin restriction is genuinely needed.

### 8.4 Other

- **bcryptjs, 12 rounds.** Password hashing lives in `src/utils/security.js`.
- **Rate limiters** exist per-surface (`globalLimiter`, `formLimiter` on public forms,
  `paymentLimiter` on payment endpoints) from `express-rate-limit`.
- **Helmet CSP** allows `'unsafe-inline'` for style and script, with
  `crossOriginEmbedderPolicy: false`. This is a deliberate trade for an inline-script-heavy EJS
  codebase — tightening it is a real project, not a one-line change.
- **Body limits**: `express.urlencoded({ limit: '2mb' })`.
- **Static**: 30-day `maxAge` in production.
- **Uploads**: `UPLOAD_DIR` + `MAX_UPLOAD_MB` are configured, but there is **no multer** — see §12.

---

## 9. Invariants and verification

### 9.1 Invariants

1. Cross-customer isolation: another customer's subscription / invoice / ticket must return **404**,
   not the record. This is the check that matters most.
2. Auth guards: anonymous `/admin` and `/account` must **redirect (302)**, never render.
3. Webhook signature handling: bad signatures must be **4xx, never 5xx**. An errored IPN is retried
   by the gateway, so a 500 becomes a retry loop.
4. `/pricing` intentionally **301**s to `/packages`. Do not delete the redirect; other pages link to
   it.
5. Document numbers are globally unique and monotonically climbing per kind.
6. `amountPaid` is derived, never assigned.
7. Every POST form carries `csrfField`.

### 9.2 The three shipped tools

```bash
npm run lint:views            # static analysis of every EJS view
npm run lint:views:selftest   # proves the analyser can actually detect a fault
npm run lint:view <file>      # audit one view and print what it requires
npm run smoke                 # end-to-end HTTP sweep (needs a running server)
```

### 9.3 `lint:views` — read this before trusting it

The analyser compiles every template, extracts the exact set of names each view reads from its
locals, and diffs that against (a) the globals injected in `src/app.js` and (b) the keys each route
actually passes to `res.render`. It reports any name a view needs that nothing supplies.

Two implementation details that a rewrite must preserve:

1. **`ejs.compile({ client: true })` is the only mode whose `toString()` exposes the real template
   body.** The default and `compileDebug` modes return a ~427-character dispatcher that hides the
   body in a closure — an analyser built on those sees nothing.
2. **The `with (locals || {})` header contains a brace pair.** Naïve brace-matching from the first
   `{` after `with` grabs the empty `{}` and yields a **zero-length body** — a silent false "clean".

The bug class it catches by design:

- a view referencing a local its route never passes (e.g. `sub` vs `subscription`)
- **the no-op guard** — `undefinedLocal || fallback` still throws, because the identifier resolves
  before `||`. The analyser reports `typeof`-guarded names separately as intentional optionals.

`npm run lint:views:selftest` plants a fake undefined local and asserts detection. **A clean sweep is
only meaningful if the self-test passes** — an earlier version of this analyser once reported all 56
views clean while being completely blind to a planted fault, because it was scanning the wrong
compiled output.

`npm run lint:view <file>` localises a single template — the workflow that actually found the
`paymentStatuses` bug:

```bash
npm run lint:view views/admin/orders/detail.ejs
# view          : views/admin/orders/detail.ejs
# required      : C, Math, Number, canDelete, csrfField, fmt, helpers, nextStatuses, ...
# typeof-guarded: (none)
```

`scripts/run-audit.js` also exports `auditSource()` for testing a template string with no file on
disk:

```js
const { auditSource } = require('./scripts/run-audit');
const r = auditSource("<%- totallyBogus || 1 %>");
if (!r.names.has('totallyBogus')) throw new Error('detector is blind');
```

### 9.4 `npm run smoke`

A 247-line bash script. **It boots no server of its own** — run `npm run dev` in another terminal
first. It discovers the record IDs it needs from the database and logs in with the seeded
credentials, so it works against any freshly seeded instance with no manual setup.

Counts as of this writing: **8 `hit` invocations** plus 75 public paths, 52 admin paths and 6
webhook `post` calls in loops — a live run reports roughly 73 passing assertions. Read the script for
the current number rather than trusting this.

**The caveat that makes part of it vacuous.** The webhook assertions are only *logically* exercised
when `SSLCOMMERZ_STORE_PASSWORD` is set. With no secret configured, `verifyWebhook` returns `false`
at its first guard (`if (!secret) return false`) and the length comparison is never reached — so a
live sweep against a default `.env` **cannot see the timing-safe bug class**. To test it directly,
inject the secret:

```bash
SSLCOMMERZ_STORE_PASSWORD="testpw" node -e '
  const gw = require("./src/services/paymentGateway.service");
  console.log(gw.GATEWAYS.SSLCOMMERZ.verifyWebhook({
    tran_id: "t", amount: "100", currency: "BDT", verify_sign: "short"
  }));  // must be false, must not throw
'
```

### 9.5 Two environment traps that waste an hour each

- **`http_proxy` intercepts localhost.** If your shell exports a proxy, curl routes even localhost
  through it and you get a **502 Bad Gateway that looks exactly like the app being down**. The smoke
  script bypasses the proxy for localhost explicitly. Apply the same `NO_PROXY` handling in any new
  script.
- **`node src/server.js &` can die when the shell exits.** Use a real terminal, `npm run dev`, or a
  proper background-service mechanism.

---

## 10. Configuration

Everything is environment-driven. `.env.example` is the annotated reference:

| Area | Keys |
| --- | --- |
| Core | `NODE_ENV`, `PORT`, `APP_URL`, `APP_NAME`, `DATABASE_URL` |
| Sessions | `SESSION_SECRET` — **must change in production**, guarded at boot |
| Admin bootstrap | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seeder only) |
| Gateways | `SSLCOMMERZ_STORE_ID/_PASSWORD/_SANDBOX`, `BKASH_APP_KEY/_APP_SECRET/_USERNAME/_PASSWORD/_SANDBOX` |
| Manual wallets | `BKASH_/NAGAD_/ROCKET_MERCHANT_NUMBER` |
| Courier | `PATHAO_CLIENT_ID/_SECRET`, `STEADFAST_API_KEY/_SECRET_KEY` |
| Mail | `SMTP_HOST/_PORT/_USER/_PASSWORD/_FROM` |
| SMS | `BULKSMS_API_KEY/_SENDER_ID` |
| Uploads | `UPLOAD_DIR`, `MAX_UPLOAD_MB` |

Gateways, SMTP and couriers are **optional**. The app runs without any of them.

### 10.1 npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | dev server with `--watch` |
| `npm start` | production server |
| `npm run build` / `postinstall` | `prisma generate` |
| `npm run db:push` | push schema to the DB |
| `npm run db:seed` | seed demo data (idempotent) |
| `npm run db:reset` | drop + recreate |
| `npm run db:provider <name>` | switch `sqlite` \| `postgresql` \| `mysql` |
| `npm run setup` | `db:push` + `db:seed` |
| `npm run smoke` | end-to-end HTTP sweep |
| `npm run lint:views` / `:selftest` / `lint:view <file>` | view/locals auditing |

**`prisma generate` is not optional.** Prisma Client is generated code living in
`node_modules/.prisma` and is **not committed**. A fresh clone has no client until `postinstall` or
`build` runs; without it the app crashes on the first query with
`Cannot find module '.prisma/client/default'`. Every deploy target must run a build step.

---

## 11. Deployment

### 11.1 SQLite is a development-only choice

On **Hostinger Web Apps** — and most shared Node hosts — the app runs from a **versioned build
directory that is replaced on every deploy**. A SQLite file written at runtime is lost on the next
push. Local development uses `file:./woohelperpro.db`; production must use a server database.

Switching is a two-step operation and needs **no schema restructuring**, because the enum-typed
columns are already plain `String`s:

```bash
npm run db:provider mysql        # or postgresql
# point DATABASE_URL at the server
npm run db:push
```

### 11.2 Hostinger MySQL: the two traps

**Trap 1 — `127.0.0.1`, not `localhost`.** An app running *inside* Hostinger must connect to
`127.0.0.1`. `localhost` resolves to IPv6 `::1`, and the database user is not granted from `::1`. The
error is `Access denied for user '…'@'::1'`.

Note the direction: an app inside the host wants `127.0.0.1`, whereas a laptop connecting *in* from
outside wants the host's external address. Same word, opposite meaning.

**Trap 2 — URL-encoding.** `#` starts a URL fragment, so a password containing `#` makes the
connection string structurally invalid:

```bash
node -e 'new URL("mysql://u:pa#ss@host:3306/db")'
# TypeError [ERR_INVALID_URL]
```

Percent-encode it (`%23`). Same for `@`, `:`, `/`, `?`.

### 11.3 `ER_ACCESS_DENIED_ERROR` is not a diagnosis

MySQL returns a **byte-identical** error for a bad password and for a non-allowlisted client IP. You
cannot tell them apart from the message. Run a control test — the same command twice, once with a
deliberately wrong password:

- Both fail identically → you are almost certainly being **IP-blocked**, not mistyping.
- The wrong password fails *differently* → the credential is the problem.

Also note the database user's allowed host may be a **specific dynamic IP** if the hosting panel
auto-detected one, which silently breaks the moment your IP changes.

### 11.4 Production checklist

- [ ] `SESSION_SECRET` set to 48+ random bytes (**not** containing `change-me` / `dev-only`)
- [ ] `NODE_ENV=production` (this is what enables `secure` cookies and the bootstrap guard)
- [ ] `DATABASE_URL` on a server database, host `127.0.0.1` for in-host apps, password URL-encoded
- [ ] Build step present: `npm run build` (or rely on `postinstall`)
- [ ] `APP_URL` matches the real HTTPS origin
- [ ] Schema pushed: `npm run db:push`
- [ ] Admin password changed from the seeded default
- [ ] Verified by *requesting real pages*, not by a green build log

A working deployment guide with the concrete settings lives in
[`docs/DEPLOY-HOSTINGER.md`](./DEPLOY-HOSTINGER.md).

---

## 12. Known drift (read this before trusting the README)

`README.md` is a good document but it is **behind the code** in three places. Fix the README rather
than coding to it.

| README says | Reality |
| --- | --- |
| "**multer** uploads, **nodemailer** mail, **sharp** image processing" | `multer` and `sharp` were **removed** from `package.json`. `grep -rn "multer\|sharp" src/ package.json` returns nothing. Only `nodemailer` remains, and mail is optional/best-effort. There is no upload middleware despite `UPLOAD_DIR` / `MAX_UPLOAD_MB` still being configured. |
| "Postgres is required" (Hostinger note) | The account runs on **MySQL**. `db:provider` supports `sqlite`/`postgresql`/`mysql`. Postgres is *a* valid target, not *the* required one. |
| "18 keys" implied for `PERMISSIONS`; "56 views" mentioned in the self-test anecdote | There are **21** permission keys and **72** views now. These numbers are historical colour, not current facts. |

If you change behaviour, update the README in the same commit. Drift of this kind is how an agent
ends up writing code against a stack that no longer exists.

---

## 13. The template contract

Globals injected in `src/app.js`, available in **every** view:

```
app  env  C  fmt  json  currentPath  query  helpers  t  settings  theme  lang
title  metaTitle  metaDescription  bodyClass
success  error  … (flash arrays)  csrfField  csrfToken
currentUser  can  isStaff  isAdmin      ← when signed in
```

`helpers` exports exactly four functions: `statusBadge`, `statusBadgeT`, `progressBar`, `emptyState`.
`statusBadge(value, map)` falls back to a neutral badge for an unknown value, so a stale DB row never
crashes a page — keep that behaviour.

`t()` handles en/bn translation; `lang` is switched via `GET /lang/:code` and `theme` via
`GET /theme/:name`.

Three things that bite, restated because they are the top three causes of render-time 500s:

- The signed-in user is **`currentUser`**, never `user`.
- Every POST form must include **`<%- csrfField %>`**.
- **Views cannot reliably `require()`** — pass what you need as a local.
- And the corollary: **never write `x || fallback` for a possibly-absent local**; use
  `typeof x !== 'undefined'`.

### 13.1 Route inventory (from source, not docs)

<details>
<summary><strong>Public</strong> — <code>public.routes.js</code></summary>

```
GET  /  /services  /services/:slug  /packages  /packages/:slug
     /order/checkout  /portfolio  /about  /pricing (301 → /packages)
     /blog  /blog/:slug  /contact  /legal/:page
POST /order/quote         (formLimiter)
     /order/checkout      (formLimiter)
     /contact
     /request-callback
```
</details>

<details>
<summary><strong>Auth</strong> — <code>auth.routes.js</code></summary>

```
GET  /login  /register  /forgot-password  /lang/:code  /theme/:name
POST /login  /register  /logout  /forgot-password
```
</details>

<details>
<summary><strong>Account</strong> — <code>account.routes.js</code>, all under <code>/account</code></summary>

```
GET  /  /orders  /orders/:id  /subscriptions  /subscriptions/:id
     /invoices  /invoices/:id  /payments  /tickets  /tickets/:id  /profile
POST /orders/:id/cancel
     /subscriptions/:id/auto-renew   /subscriptions/:id/cancel
     /invoices/:id/pay               (paymentLimiter)
     /tickets  /tickets/:id/reply
     /profile  /profile/password
```
</details>

<details>
<summary><strong>Admin</strong> — 9 sub-routers + dashboard, all inheriting <code>requireStaff</code></summary>

```
Dashboard   GET /admin  /admin/reports  /admin/activity
Users       11 routes, requirePermission('users'); delete under 'usersDelete'
Services    11 routes incl. /categories, all under 'services'
Packages    7 routes, 'packages'
Orders      9 routes, 'orders' + 'projects' for milestone toggle + 'ordersDelete' + 'invoices'
Subscriptions 9 routes, 'subscriptions'
Billing     invoices (4) + payments (5)
CRM         tickets (4)  leads (5)  coupons (4)  projects (4)
Content     testimonials (4)  portfolio (4)  blog (6)  faqs (4)  settings (2)
```
</details>

<details>
<summary><strong>API</strong> — <code>api.routes.js</code>, JSON</summary>

```
GET  /api/services
GET  /api/packages
POST /api/quote
POST /api/coupons/validate
GET  /api/me              (requireAuth)
```
</details>

<details>
<summary><strong>Payments</strong> — <code>payment.routes.js</code></summary>

```
GET  /payments/callback/sslcommerz
POST /payments/webhook/sslcommerz     ← CSRF-exempt, signature-verified
POST /payments/webhook/bkash          ← CSRF-exempt, signature-verified
```
</details>

---

## 14. Conventions

- **`'use strict';`** at the top of every module.
- **CommonJS**: `require` / `module.exports`. No `import`.
- **File naming**: `kebab-case.js`; routes end in `.routes.js`; views are `kebab-case.ejs`.
- **Route handler shape**: always `async (req, res, next)` with errors forwarded via
  `try { … } catch (e) { next(e); }` — there is a central error handler, do not `res.send` errors
  inline.
- **Service shape**: pure functions taking explicit arguments, returning plain objects. Services do
  not touch `req`/`res`. Keep the boundary — it is what makes `smoke-test.sh` possible.
- **Comments explain *why*, not *what*.** The existing code documents traps inline (the
  `verifyWebhook` length guard, the `ids.nextSequence` deprecation, the `require` in package.json's
  `build`). Match that density and that intent.
- **Layering**: `routes/` orchestrates, `services/` decides, `utils/` is leaf-level and pure,
  `middleware/` is cross-cutting. Do not put business rules in a route handler or a view.
- **The seeder is idempotent** via deterministic natural keys (email, slug, code, order number) and a
  fixed-seed PRNG. Re-running it must not duplicate rows. Preserve that property when adding
  entities.

---

## 15. Prompt templates

### 15.1 Feature work

> You are working in the WooHelperPro codebase. Read `docs/AI-PROMPT.md` first and follow its §0 core
> rules exactly.
>
> **Task:** _<describe the feature>_
>
> Constraints: keep the stack (Express 4 / CommonJS / Prisma 5 / EJS); no new dependencies without
> justifying them; use `ids.nextSequenceFrom()` for any new document number; apply VAT after
> discounts; derive `amountPaid` from `SUCCESS` payments; gate admin routes with
> `requirePermission`; add `<%- csrfField %>` to any new form.
>
> Before you finish: run `npm run lint:views:selftest && npm run lint:views`, then `npm run smoke`
> against a dev server, and report the **actual output** — not "it should work".

### 15.2 Bug fix

> You are working in the WooHelperPro codebase. Read `docs/AI-PROMPT.md`, especially §9 invariants.
>
> **Symptom:** _<the observed failure, verbatim>_
>
> Find the root cause before changing anything. State what you believe the cause is, then verify it
> with a command whose output you can show. Check whether the failure matches any known trap in §9.5,
> §11.2 or §11.3 before assuming it is new.
>
> Fix the cause, not the symptom. If the fix is a guard, leave a comment saying which failure it
> prevents. Re-run the relevant verification and report real output.

### 15.3 Deployment

> You are deploying WooHelperPro. Read `docs/AI-PROMPT.md` §10–§11 and
> `docs/DEPLOY-HOSTINGER.md`.
>
> Confirm before you start: `NODE_ENV=production`, a non-placeholder `SESSION_SECRET`, a server
> `DATABASE_URL` with the password percent-encoded, and a build step that runs `prisma generate`.
>
> Do not report success on the basis of a green build. Fetch a real page, confirm the login round-trip
> and the session cookie, and show the resulting HTTP statuses.

---

## Appendix: verification log for this document

Everything asserted above was checked against the working tree on **2026-09-20**:

| Claim | How it was checked |
| --- | --- |
| 22 models, 0 enums | `grep -c "^model "` / `"^enum "` on `schema.prisma` |
| 72 views, 3 layouts | `find views -name '*.ejs' \| wc -l`; `ls views/layouts` |
| 16 route files, 9 services, 37 `src` files | `find` + `wc -l` |
| 21 permission keys | `sed -n '/const PERMISSIONS/,/^};/p'` + key extraction |
| Value-set sizes, 64 districts | `node -e "require('./src/config/constants')"` — introspected live |
| `helpers` exports exactly 4 symbols, no `csrfField` | required the module and printed `Object.keys` |
| Zero `require(`/`__dirname` in `views/` | `grep -rn` over `views/` |
| No `multer`/`sharp`/`supabase` anywhere | `grep -rn` over `src/` and `package.json` |
| `SESSION_SECRET` generator yields 64 chars, no shell-hostile characters | 5 generator runs + round-trip through a `.env` line |
| Boot guard rejects `""`, `change-me`, `dev-only-secret`, `change-me-please` | Executed the guard directly; exit 1 with `[FATAL]` |
| Webhook length guard returns `false` without throwing | Direct `verifyWebhook({verify_sign: 'short'})` with a secret injected |

**Not done, and deliberately not claimed:** `npm run smoke` was not re-run for this document, so the
"~73 assertions" figure is derived from reading `scripts/smoke-test.sh` (8 `hit` calls, 3 path loops
of 15/7/26 entries, 6 `post` calls, plus 9 conditional `hit` calls) rather than from a live pass.
Run it and correct the number if you care about it.
