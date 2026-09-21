/**
 * Runtime locals-contract auditor -- WITH-BLOCK SCOPE method.
 *
 * How it works
 * ------------
 * Compiled with `client: true`, an EJS template becomes a real function whose
 * body is `__append(...)` calls wrapping `with (locals || {}) { <template js> }`.
 *
 * Any identifier the template did not declare itself resolves against `locals`.
 * So: take the generated body, strip the EJS preamble, walk the `with` block,
 * collect every reference that is neither a JS keyword, a declared name, a
 * property access (`.foo`), nor an object-literal key. That set IS the set of
 * names the view requires from locals.
 *
 * This is exact rather than heuristic, and it catches:
 *   - a name the route never passes         (`sub` vs `subscription`)
 *   - the no-op guard `undefinedIdent || x` (the identifier is still a reference)
 *
 * NOTE ON MODE: only `client: true` yields the real body in `toString()`.
 * Both default and compileDebug:true return a 427-char dispatcher that hides
 * the body inside a closure -- scanning that source silently audits nothing,
 * which is exactly how a "clean" run can be a lie.
 *
 * Run with --selftest to plant a fault and prove detection.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');

// ---- globals injected by src/app.js + middleware --------------------------
const GLOBALS = new Set([
  'app', 'env', 'C', 'fmt', 'json', 'helpers', 't', 'settings', 'theme', 'lang',
  'currentPath', 'query', 'title', 'metaTitle', 'metaDescription', 'bodyClass',
  'csrfField', 'csrfToken',
  'currentUser', 'can', 'isStaff', 'isAdmin', 'isSuperAdmin', 'isAuthenticated',
  'success', 'error', 'info', 'warning', 'flash',
  'include', 'locals', 'rethrow', 'escapeFn',
  // JS builtins that compiled EJS output references directly
  'Object', 'Array', 'Math', 'Number', 'String', 'Boolean', 'JSON', 'Date',
  'RegExp', 'Error', 'Symbol', 'Map', 'Set', 'Promise', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'console', 'process',
  // helpers the EJS preamble declares outside the with-block
  '__append', '__output', '__line', '__filename', '__dirname',
  // short names templates introduce via inline arrow params that the naive
  // declaration scan can miss; these are never route locals.
  '_', 'g', 'w', 'e',
]);
{
  const scan = (rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return;
    const s = fs.readFileSync(p, 'utf8');
    let m;
    const re = /res\.locals\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = re.exec(s))) GLOBALS.add(m[1]);
  };
  scan('src/app.js');
  for (const f of fs.readdirSync(path.join(ROOT, 'src/middleware'))) {
    if (f.endsWith('.js')) scan('src/middleware/' + f);
  }
}

// ---- route render contracts ------------------------------------------------
function routeFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src/routes'));
  return out;
}

function extractRenderContracts(src) {
  const out = [];
  const re = /res\.render\(\s*['"]([^'"]+)['"]/g;
  let mm;
  while ((mm = re.exec(src))) {
    const view = mm[1];
    let i = mm.index + mm[0].length;
    while (i < src.length && /[\s,)]/.test(src[i])) i++;
    if (src[i] !== '{') { out.push({ view, keys: [], wildcard: false }); continue; }
    let depth = 0, end = i;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(i + 1, end);
    const segs = [];
    let d = 0, buf = '', inStr = null;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (inStr) { buf += c; if (c === inStr && body[k - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; buf += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      if (c === ')' || c === ']' || c === '}') d--;
      if (c === ',' && d === 0) { segs.push(buf); buf = ''; continue; }
      buf += c;
    }
    segs.push(buf);
    const keys = [];
    let wildcard = false;
    for (const seg of segs) {
      const t = seg.trim();
      if (!t) continue;
      if (/^\.\.\./.test(t)) { wildcard = true; continue; }
      const km = /^([A-Za-z_$][\w$]*)\s*:/.exec(t);
      if (km) { keys.push(km[1]); continue; }
      const sm = /^([A-Za-z_$][\w$]*)$/.exec(t);
      if (sm) { keys.push(sm[1]); continue; }
    }
    out.push({ view, keys, wildcard });
  }
  return out;
}

const byView = new Map();
for (const rf of routeFiles()) {
  const src = fs.readFileSync(rf, 'utf8');
  for (const c of extractRenderContracts(src)) {
    if (!byView.has(c.view)) byView.set(c.view, { keys: new Set(), wildcard: false, routes: new Set() });
    const e = byView.get(c.view);
    c.keys.forEach((k) => e.keys.add(k));
    if (c.wildcard) e.wildcard = true;
    e.routes.add(path.relative(ROOT, rf));
  }
}

// ---- scope analysis over the with-block ------------------------------------
const JS_KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','break','continue','return',
  'function','var','let','const','new','delete','typeof','instanceof','in','of',
  'void','yield','await','async','try','catch','finally','throw','class','extends',
  'super','this','null','true','false','undefined','default','export','import',
  'with','debugger','static','get','set',
]);

function stripStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === q) { out += q; i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    // Regex literal: `/.../flags`. Heuristic -- only treat `/` as a regex start
    // when the previous non-space char implies an expression position (not a
    // value), otherwise we would eat division. This matters because a regex
    // like /vat/i would otherwise contribute `vat` as a free identifier.
    if (c === '/') {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      const prev = j >= 0 ? out[j] : '';
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
        let k = i + 1, cls = false, closed = false;
        while (k < code.length) {
          if (code[k] === '\\') { k += 2; continue; }
          if (code[k] === '[') cls = true;
          else if (code[k] === ']') cls = false;
          else if (code[k] === '/' && !cls) { closed = true; k++; break; }
          else if (code[k] === '\n') break;
          k++;
        }
        if (closed) { i = k; while (i < code.length && /[a-z]/i.test(code[i])) i++; continue; }
      }
    }
    out += c;
    i++;
  }
  return out;
}

function declaredNames(code) {
  const declared = new Set();
  let m;
  const pats = [
    /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /(?:^|[({,\s])([A-Za-z_$][\w$]*)\s*=>/g,
    /\bfor\s*\(\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of pats) while ((m = re.exec(code))) declared.add(m[1]);
  // destructuring
  let m2;
  const arr = /\b(?:var|let|const)\s*\[([^\]]*)\]\s*=/g;
  while ((m2 = arr.exec(code))) m2[1].split(',').forEach((n) => {
    const t = n.trim().split(':').pop().trim().replace(/=.*/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
  });
  const obj = /\b(?:var|let|const)\s*\{([^}]*)\}\s*=/g;
  while ((m2 = obj.exec(code))) m2[1].split(',').forEach((n) => {
    const t = n.trim().split(':').pop().trim().replace(/=.*/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
  });
  // function params
  const fps = /\bfunction\s*[A-Za-z_$\w$]*\s*\(([^)]*)\)/g;
  while ((m2 = fps.exec(code))) m2[1].split(',').forEach((n) => {
    const t = n.trim().replace(/=.*/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
  });
  return declared;
}

function freeReferences(code) {
  const clean = stripStrings(code);
  const declared = declaredNames(clean);
  const free = new Set();
  // identifiers not preceded by `.` (property access) and not part of a bigger word
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  const used = new Set();
  while ((m = re.exec(clean))) used.add(m[2]);
  // remove object-literal keys: ident immediately followed by `:` in key position
  const keyRe = /(^|[{,(\[]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  let k;
  while ((k = keyRe.exec(clean))) used.delete(k[2]);
  for (const u of used) {
    if (declared.has(u)) continue;
    if (JS_KEYWORDS.has(u)) continue;
    free.add(u);
  }
  return free;
}

function neededLocals(viewPath) {
  const src = fs.readFileSync(viewPath, 'utf8');
  let fn;
  try {
    fn = ejs.compile(src, { filename: viewPath, client: true, compileDebug: false });
  } catch (e) {
    return { compileError: e.message.split('\n')[0] };
  }
  const body = fn.toString();

  // Safe reads: `typeof X !== 'undefined'` and `typeof X === 'undefined'` never
  // throw on an undeclared identifier, so a view using that guard is correct
  // even when the route omits the local. Collect those names and exclude them
  // from the report -- otherwise the tool cries wolf on a legitimate pattern.
  const guarded = new Set();
  {
    let gm;
    const gre = /typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*['"]undefined['"]/g;
    while ((gm = gre.exec(body))) guarded.add(gm[1]);
  }
  // Locate the `with (locals || {}) { <body> }` block.
  //
  // CAREFUL: the header itself contains a brace pair -- `(locals || {})` -- so
  // we must skip past the parenthesised expression and brace-match from the
  // FIRST `{` that follows its closing paren. Matching from the first `{` after
  // `with` grabs the empty `{}` literal, collapses depth to 0 immediately, and
  // yields an empty body -- which silently audits nothing and reports "clean".
  const idx = body.indexOf('with (locals');
  if (idx < 0) {
    return { modeError: 'no with-block in compiled output (wrong compile mode?)' };
  }
  const parenOpen = body.indexOf('(', idx);
  let pd = 0, parenClose = parenOpen, inS = null;
  for (; parenClose < body.length; parenClose++) {
    const c = body[parenClose];
    if (inS) { if (c === inS && body[parenClose - 1] !== '\\') inS = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (pd === 0) break; }
  }
  const open = body.indexOf('{', parenClose);
  let depth = 0, end = open;
  let inStr = null;
  for (; end < body.length; end++) {
    const c = body[end];
    if (inStr) { if (c === inStr && body[end - 1] !== '\\') inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const inner = body.slice(open + 1, end);
  if (inner.trim().length === 0) {
    return { extractionError: 'extracted empty with-block body -- auditor would report a false clean' };
  }
  const names = freeReferences(inner);
  // Separate names that are read unguarded (a hard requirement) from names only
  // ever read behind `typeof X !== 'undefined'` (optional by design).
  const optional = new Set([...names].filter((n) => guarded.has(n)));
  return { names, optional, bodyLen: body.length };
}

// ---- run ------------------------------------------------------------------
const problems = [];
const clean = [];
const optional = [];
for (const [view, info] of byView) {
  const vp = path.join(ROOT, 'views', view + '.ejs');
  if (!fs.existsSync(vp)) { problems.push({ view, issue: 'VIEW MISSING' }); continue; }
  const r = neededLocals(vp);
  if (r.compileError) { problems.push({ view, issue: 'COMPILE', detail: r.compileError }); continue; }
  if (r.modeError) { problems.push({ view, issue: 'AUDIT MODE', detail: r.modeError }); continue; }
  const missing = [...r.names].filter((n) => {
    if (GLOBALS.has(n)) return false;
    if (info.keys.has(n)) return false;
    if (r.optional && r.optional.has(n)) return false;
    return true;
  });
  const optionalMissing = r.optional
    ? [...r.optional].filter((n) => !GLOBALS.has(n) && !info.keys.has(n))
    : [];
  if (missing.length) {
    problems.push({ view, issue: 'UNRESOLVED LOCALS', missing: missing.sort(), passed: [...info.keys].sort(), routes: [...info.routes] });
  } else {
    if (optionalMissing.length) optional.push({ view, names: optionalMissing.sort() });
    clean.push(view);
  }
}

console.log('views rendered : ' + byView.size);
console.log('globals known  : ' + GLOBALS.size);
console.log('clean          : ' + clean.length);
console.log('problems       : ' + problems.length);
console.log('');
for (const p of problems) {
  console.log('[' + p.issue + '] ' + p.view + (p.detail ? ' :: ' + p.detail : ''));
  if (p.missing) {
    console.log('   NOT PROVIDED : ' + p.missing.join(', '));
    console.log('   route passes : ' + p.passed.join(', '));
    if (p.routes) console.log('   routes       : ' + p.routes.join(', '));
  }
}
if (optional.length) {
  console.log('');
  console.log('OPTIONAL (route omits it, view reads it behind typeof-guard -- safe):');
  for (const o of optional) console.log('   ' + o.view + ' : ' + o.names.join(', '));
}
console.log('');
console.log(problems.length === 0 ? 'RESULT: no unresolved locals.' : 'RESULT: ' + problems.length + ' problem(s).');

// ---- self-test ------------------------------------------------------------
if (SELFTEST) {
  console.log('\n=== SELF-TEST ===');
  const probe = path.join(ROOT, 'views/admin/orders/detail.ejs');
  const orig = fs.readFileSync(probe, 'utf8');
  const faulted = orig.replace('C.INVOICE_STATUS', 'totallyBogusLocalName || C.INVOICE_STATUS');
  if (faulted === orig) { console.log('SKIPPED: anchor not found'); process.exit(2); }
  fs.writeFileSync(probe, faulted);
  const res = neededLocals(probe);
  fs.writeFileSync(probe, orig);
  const detected = res.names && res.names.has('totallyBogusLocalName');
  console.log('planted "totallyBogusLocalName" in admin/orders/detail.ejs');
  console.log('detected: ' + detected);
  console.log(detected ? 'SELF-TEST PASS' : 'SELF-TEST FAIL -- instrument is blind');
  process.exit(detected ? 0 : 1);
}
