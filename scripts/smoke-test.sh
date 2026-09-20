#!/usr/bin/env bash
#
# Smoke test for WooHelperPro.
#
# Verifies every read surface across the three areas (public, customer, admin)
# against a running server, and asserts the security-critical negatives:
# cross-customer record access must 404, and anonymous access must redirect.
#
# It discovers its own record IDs from the database and logs itself in, so it is
# safe to run against a freshly seeded instance with no manual setup.
#
# Usage:
#   npm run smoke                 # expects a server on http://localhost:3000
#   BASE=http://host:port npm run smoke
#
set -u

BASE=${BASE:-http://localhost:3000}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE=${NODE:-node}

# Scratch space for the cookie jars.
#
# IMPORTANT: curl on Windows is a native binary and cannot resolve a Git Bash
# path like /d/foo/bar -- it fails silently to write the jar, so every
# subsequent request goes out unauthenticated and the suite reports spurious
# 302s. Use a RELATIVE path (resolved against the current directory) so both
# Git Bash and native curl agree on where the file lives.
cd "$ROOT" || exit 2
CWD=".smoke-tmp"
rm -rf "$CWD" 2>/dev/null
mkdir -p "$CWD" || { echo "ERROR: cannot create $CWD" >&2; exit 2; }
cleanup() { rm -rf "$ROOT/.smoke-tmp" 2>/dev/null || true; }
trap cleanup EXIT

# Bypass any HTTP proxy for localhost.
#
# If the shell has http_proxy / HTTP_PROXY set (common in sandboxed and
# corporate environments), curl routes requests for localhost through that
# proxy too. The proxy cannot reach the local dev server and answers 502 Bad
# Gateway -- which looks exactly like the app being down. Force a direct
# connection so the suite tests the server, not the proxy.
NO_PROXY_ARG=(--noproxy '*')
export NO_PROXY="localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"

PASS=0; FAIL=0; FAILED=()

# ---------------------------------------------------------------- helpers
hit() { # hit <label> <expected-status> <path> <cookiejar|->
  local label="$1" want="$2" url="$3" jar="$4"
  local args=(-s "${NO_PROXY_ARG[@]}" -o /dev/null -w "%{http_code}" --max-time 20)
  [ "$jar" != "-" ] && args+=(-b "$jar")
  local code; code=$(curl "${args[@]}" "$BASE$url" 2>/dev/null)
  # curl can emit the write-out and still exit non-zero on some builds, leaving
  # a doubled value ("200200"). Keep the leading 3 digits only.
  code=$(printf '%s' "$code" | grep -oE '^[0-9]{3}' || printf '%s' "$code")
  if [ "$code" = "$want" ]; then
    printf 'ok   %s %s\n' "$code" "$label"; PASS=$((PASS+1))
  else
    printf 'FAIL %s (want %s) %s\n' "$code" "$want" "$label"
    FAIL=$((FAIL+1)); FAILED+=("$label -> got $code, want $want")
  fi
}

csrf() { curl -s "${NO_PROXY_ARG[@]}" -b "$2" -c "$2" "$BASE$1" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"//'; }

# post <label> <expected-status> <path> <json-body>
post() {
  local label="$1" want="$2" url="$3" body="$4"
  local code; code=$(curl -s "${NO_PROXY_ARG[@]}" -o /dev/null -w "%{http_code}" \
    --max-time 20 -X POST "$BASE$url" -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
  code=$(printf '%s' "$code" | grep -oE '^[0-9]{3}' || printf '%s' "$code")
  if [ "$code" = "$want" ]; then
    printf 'ok   %s %s\n' "$code" "$label"; PASS=$((PASS+1))
  else
    printf 'FAIL %s (want %s) %s\n' "$code" "$want" "$label"
    FAIL=$((FAIL+1)); FAILED+=("$label -> got $code, want $want")
  fi
}

login() { # login <jar> <email> <password>
  rm -f "$1"
  local t; t=$(csrf /login "$1")
  curl -s "${NO_PROXY_ARG[@]}" -b "$1" -c "$1" -o /dev/null -X POST "$BASE/login" \
    --data-urlencode "_csrf=$t" --data-urlencode "email=$2" --data-urlencode "password=$3"
}

# ---------------------------------------------------------------- preflight
# Capture the status code explicitly. Note: on some shells/curl builds the
# write-out and a non-zero exit both fire, yielding values like "200000" -- so
# match on the numeric prefix rather than an exact string compare.
HEALTH=$(curl -s "${NO_PROXY_ARG[@]}" -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/health" 2>/dev/null)
case "$HEALTH" in
  200*) : ;;
  502*)
    echo "ERROR: $BASE/api/health returned '$HEALTH' (Bad Gateway)." >&2
    echo "       A proxy is intercepting localhost. Ensure http_proxy is bypassed" >&2
    echo "       for localhost, or unset it:  unset http_proxy https_proxy" >&2
    exit 2
    ;;
  *)
    echo "ERROR: $BASE/api/health returned '$HEALTH' (expected 200)" >&2
    echo "       start the server with: npm run dev" >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------- discover IDs
echo "discovering records from the database..."
IDFILE="$CWD/ids.env"
(cd "$ROOT" && "$NODE" -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const q = async (fn) => { try { return await fn(); } catch { return null; } };
(async () => {
  const cust = await q(() => p.user.findFirst({ where: { role: "CUSTOMER" }, orderBy: { createdAt: "asc" } }));
  const first = async (m, w) => (await q(() => p[m].findFirst(w || {}))) || {};
  const svc = await first("service");
  const pkg = await first("package");
  const blog = await first("blogPost");
  const order = await first("order", { orderBy: { createdAt: "desc" } });
  const sub = await first("subscription", { orderBy: { createdAt: "desc" } });
  const inv = await first("invoice", { orderBy: { createdAt: "desc" } });
  const ticket = await first("ticket");
  const mine = async (m) => (await q(() => p[m].findFirst({ where: { userId: cust && cust.id } }))) || {};
  const other = await q(() => p.subscription.findFirst({ where: { userId: { not: cust && cust.id } } }));
  const out = {
    ORDER: order.id, USERID: cust && cust.id, SUB: sub.id, INV: inv.id,
    SVCID: svc.id, SVCSLUG: svc.slug, PKGSLUG: pkg.slug,
    TICKET: ticket.id, BLOG: blog.id, BLOGSLUG: blog.slug,
    CUSTEMAIL: cust && cust.email,
    MYS: (await mine("subscription")).id, MYI: (await mine("invoice")).id,
    MYT: (await mine("ticket")).id, MYO: (await mine("order")).id,
    OTHERSUB: other && other.id,
  };
  for (const [k, v] of Object.entries(out)) if (v) console.log(`${k}=${v}`);
  await p.$disconnect();
})();
' 2>/dev/null) > "$IDFILE"

get() { grep "^$1=" "$IDFILE" | cut -d= -f2-; }
ORDER=$(get ORDER); USERID=$(get USERID); SUB=$(get SUB); INV=$(get INV)
SVCID=$(get SVCID); SVCSLUG=$(get SVCSLUG); PKGSLUG=$(get PKGSLUG)
TICKET=$(get TICKET); BLOG=$(get BLOG); BLOGSLUG=$(get BLOGSLUG)
CUSTEMAIL=$(get CUSTEMAIL); MYSUB=$(get MYS); MYINV=$(get MYI)
MYTICKET=$(get MYT); MYORDER=$(get MYO); OTHERSUB=$(get OTHERSUB)

if [ -z "$ORDER" ] || [ -z "$CUSTEMAIL" ]; then
  echo "ERROR: database looks unseeded. Run: npm run db:seed" >&2
  exit 2
fi

# ---------------------------------------------------------------- sessions
ADMIN_EMAIL=$(grep -oP '(?<=^ADMIN_EMAIL=).*' "$ROOT/.env" 2>/dev/null | tr -d '"' | tr -d "'")
ADMIN_PASSWORD=$(grep -oP '(?<=^ADMIN_PASSWORD=).*' "$ROOT/.env" 2>/dev/null | tr -d '"' | tr -d "'")
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@woohelperpro.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-WooHelper@2026}

login "$CWD/admin.txt" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
login "$CWD/cust.txt" "$CUSTEMAIL" "Demo@1234"

echo
echo "===== PUBLIC (anonymous) ====="
# /pricing 301-redirects to /packages by design.
for u in / /services /packages /portfolio /about /blog /contact \
         /legal/privacy /legal/terms /legal/refund \
         /order/checkout /login /register /forgot-password; do
  hit "$u" 200 "$u" "-"
done
hit "/pricing (301 -> /packages)" 301 "/pricing" "-"
[ -n "$SVCSLUG" ] && hit "/services/<slug>" 200 "/services/$SVCSLUG" "-"
[ -n "$PKGSLUG" ] && hit "/packages/<slug>" 200 "/packages/$PKGSLUG" "-"
[ -n "$BLOGSLUG" ] && hit "/blog/<slug>" 200 "/blog/$BLOGSLUG" "-"
hit "/api/health" 200 "/api/health" "-"

echo
echo "===== CUSTOMER (/account) ====="
for u in /account /account/orders /account/subscriptions /account/invoices \
         /account/payments /account/tickets /account/profile; do
  hit "$u" 200 "$u" "$CWD/cust.txt"
done
[ -n "$MYORDER" ] && hit "/account/orders/<own>" 200 "/account/orders/$MYORDER" "$CWD/cust.txt"
[ -n "$MYSUB" ] && hit "/account/subscriptions/<own>" 200 "/account/subscriptions/$MYSUB" "$CWD/cust.txt"
[ -n "$MYINV" ] && hit "/account/invoices/<own>" 200 "/account/invoices/$MYINV" "$CWD/cust.txt"
[ -n "$MYTICKET" ] && hit "/account/tickets/<own>" 200 "/account/tickets/$MYTICKET" "$CWD/cust.txt"

echo
echo "===== ISOLATION (must 404, must not leak) ====="
if [ -n "$OTHERSUB" ] && [ "$OTHERSUB" != "$MYSUB" ]; then
  hit "another customer's subscription" 404 "/account/subscriptions/$OTHERSUB" "$CWD/cust.txt"
else
  echo "skip  (no other-customer subscription in the dataset)"
fi

echo
echo "===== AUTH GUARDS (must redirect) ====="
hit "anonymous /admin" 302 "/admin" "-"
hit "anonymous /account" 302 "/account" "-"

echo
echo "===== WEBHOOK SIGNATURE HANDLING (must never 500) ====="
# Regression guard for a latent crash: `crypto.timingSafeEqual` throws
# ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH when the buffers differ in length, so a
# malformed `verify_sign` from the network used to become a 500 -- and on a real
# gateway an errored IPN is retried, so it becomes an endless retry loop.
# A bad signature must be a clean 400/404, never a 5xx.
WEBHOOK_BODY='{"tran_id":"WHP-PAY-0000","status":"VALID","amount":"100","currency":"BDT"'
post "short verify_sign (len 3)"    400 "/payments/webhook/sslcommerz" "$WEBHOOK_BODY,\"verify_sign\":\"abc\"}"
post "long verify_sign (len 200)"   400 "/payments/webhook/sslcommerz" "$WEBHOOK_BODY,\"verify_sign\":\"$(printf 'x%.0s' {1..200})\"}"
post "empty verify_sign"            400 "/payments/webhook/sslcommerz" "$WEBHOOK_BODY,\"verify_sign\":\"\"}"
post "absent verify_sign"           400 "/payments/webhook/sslcommerz" "$WEBHOOK_BODY}"
post "wrong 32-hex (right length)"  400 "/payments/webhook/sslcommerz" "$WEBHOOK_BODY,\"verify_sign\":\"ffffffffffffffffffffffffffffffff\"}"
post "bkash unknown reference"      404 "/payments/webhook/bkash" '{"merchantInvoiceNumber":"NOPE","transactionStatus":"Completed"}'

echo
echo "===== ADMIN ====="
for u in /admin /admin/reports /admin/activity \
         /admin/users /admin/users/new \
         /admin/services /admin/services/new /admin/services/categories \
         /admin/packages /admin/packages/new \
         /admin/orders /admin/subscriptions /admin/subscriptions/new \
         /admin/invoices /admin/payments \
         /admin/tickets /admin/leads /admin/coupons /admin/projects \
         /admin/testimonials /admin/portfolio /admin/blog /admin/blog/new \
         /admin/faqs /admin/settings; do
  hit "$u" 200 "$u" "$CWD/admin.txt"
done
[ -n "$ORDER" ] && hit "/admin/orders/<id>" 200 "/admin/orders/$ORDER" "$CWD/admin.txt"
[ -n "$USERID" ] && hit "/admin/users/<id>" 200 "/admin/users/$USERID" "$CWD/admin.txt"
[ -n "$USERID" ] && hit "/admin/users/<id>/edit" 200 "/admin/users/$USERID/edit" "$CWD/admin.txt"
[ -n "$SVCID" ] && hit "/admin/services/<id>" 200 "/admin/services/$SVCID" "$CWD/admin.txt"
[ -n "$SVCID" ] && hit "/admin/services/<id>/edit" 200 "/admin/services/$SVCID/edit" "$CWD/admin.txt"
[ -n "$SUB" ] && hit "/admin/subscriptions/<id>" 200 "/admin/subscriptions/$SUB" "$CWD/admin.txt"
[ -n "$INV" ] && hit "/admin/invoices/<id>" 200 "/admin/invoices/$INV" "$CWD/admin.txt"
[ -n "$TICKET" ] && hit "/admin/tickets/<id>" 200 "/admin/tickets/$TICKET" "$CWD/admin.txt"
[ -n "$BLOG" ] && hit "/admin/blog/<id>/edit" 200 "/admin/blog/$BLOG/edit" "$CWD/admin.txt"

echo
echo "==================== SUMMARY ===================="
echo "PASS: $PASS   FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "--- failures ---"
  for f in "${FAILED[@]}"; do echo "  $f"; done
  exit 1
fi
exit 0
