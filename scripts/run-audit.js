/**
 * Adapter shim for the bundled static analyzer.
 *
 * PLACE THIS FILE IN THE TARGET REPO'S `scripts/` DIRECTORY, next to
 * `audit-view-locals.js` (copied from this skill's `references/`). It must sit in
 * `scripts/` because the analyzer resolves ROOT as `path.resolve(__dirname, '..')`.
 *
 * Why this exists: the analyzer is also a CLI, so importing it directly runs the
 * whole sweep and calls process.exit(). This shim gives you a library form.
 *
 * CLI usage (from the target repo root):
 *
 *   node scripts/run-audit.js                      # full sweep, exit code gates CI
 *   node scripts/run-audit.js --selftest           # prove the instrument is not blind
 *   node scripts/run-audit.js views/foo.ejs        # audit ONE view and print its names
 *
 * Library usage:
 *
 *   const { auditSource, report } = require("./scripts/run-audit");
 *   const r = auditSource("<%- totallyBogus || 1 %>");
 *   if (!r.names.has("totallyBogus")) throw new Error("detector is blind");
 *
 * NOTE ON supplied-locals: the sweep needs `supplied` per view, which comes from the
 * route render contracts. The full analyzer parses those itself, so prefer the CLI
 * when you want a verdict. The library form is for targeted probes and self-tests.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');

/**
 * Audit an arbitrary EJS source string. Never throws on a compile error --
 * returns { compileError } instead.
 *
 * @param {string} source  raw EJS template text
 * @param {string} [filename]  used only for error messages
 * @returns {{names?: Set<string>, optional?: Set<string>, bodyLen?: number,
 *            compileError?: string, modeError?: string, extractionError?: string}}
 */
function auditSource(source, filename) {
  let fn;
  try {
    // client:true is the ONLY mode whose toString() exposes the real body.
    fn = ejs.compile(source, {
      filename: filename || 'anonymous.ejs',
      client: true,
      compileDebug: false,
    });
  } catch (e) {
    return { compileError: String(e.message || e).split('\n')[0] };
  }
  const body = fn.toString();

  const guarded = new Set();
  {
    const gre = /typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*['"]undefined['"]/g;
    let gm;
    while ((gm = gre.exec(body))) guarded.add(gm[1]);
  }

  const idx = body.indexOf('with (locals');
  if (idx < 0) {
    return { modeError: 'no with-block in compiled output (wrong compile mode?)' };
  }
  // SKIP the parenthesised header -- `(locals || {})` contains a brace pair, so
  // brace-matching from the first `{` after `with` yields a zero-length body.
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
  let depth = 0, end = open, inStr = null;
  for (; end < body.length; end++) {
    const c = body[end];
    if (inStr) { if (c === inStr && body[end - 1] !== '\\') inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const inner = body.slice(open + 1, end);
  if (inner.trim().length === 0) {
    // An empty extraction must be a hard error, never an empty result set.
    return { extractionError: 'extracted empty with-block body -- would report a false clean' };
  }

  const names = freeRefs(inner);
  const optional = new Set([...names].filter((n) => guarded.has(n)));
  return { names, optional, bodyLen: body.length };
}

/** Audit a view file by path, relative to the repo root or absolute. */
function auditView(relOrAbs) {
  const p = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  if (!fs.existsSync(p)) return { missing: p };
  return auditSource(fs.readFileSync(p, 'utf8'), p);
}

/** Report only what is NOT supplied by globals or a route's render contract. */
function report(relOrAbs, supplied) {
  const r = auditView(relOrAbs);
  if (r.compileError) return { view: relOrAbs, issue: 'COMPILE', detail: r.compileError };
  if (r.modeError) return { view: relOrAbs, issue: 'AUDIT MODE', detail: r.modeError };
  if (r.extractionError) return { view: relOrAbs, issue: 'EXTRACTION', detail: r.extractionError };
  if (r.missing) return { view: relOrAbs, issue: 'VIEW MISSING' };
  const have = new Set(supplied || []);
  const missing = [...r.names].filter((n) => !have.has(n) && !(r.optional || new Set()).has(n));
  return { view: relOrAbs, missing: missing.sort(), optional: [...(r.optional || [])].sort() };
}

// -------------------------------------------------------------- internals
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
      const q = c; out += q; i++;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === q) { out += q; i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    // Regex literal, not division: only when the previous non-space char implies
    // an expression position. Without this, /vat/i contributes `vat` as a name.
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
    out += c; i++;
  }
  return out;
}

function declaredNames(code) {
  const declared = new Set();
  let m;
  for (const re of [
    /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /(?:^|[({,\s])([A-Za-z_$][\w$]*)\s*=>/g,
    /\bfor\s*\(\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
  ]) while ((m = re.exec(code))) declared.add(m[1]);
  let m2;
  for (const re of [/\b(?:var|let|const)\s*\[([^\]]*)\]\s*=/g, /\b(?:var|let|const)\s*\{([^}]*)\}\s*=/g]) {
    while ((m2 = re.exec(code))) m2[1].split(',').forEach((n) => {
      const t = n.trim().split(':').pop().trim().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    });
  }
  const fps = /\bfunction\s*[A-Za-z_$\w$]*\s*\(([^)]*)\)/g;
  while ((m2 = fps.exec(code))) m2[1].split(',').forEach((n) => {
    const t = n.trim().replace(/=.*/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
  });
  return declared;
}

function freeRefs(code) {
  const clean = stripStrings(code);
  const declared = declaredNames(clean);
  const used = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(clean))) used.add(m[2]);
  const keyRe = /(^|[{,(\[]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  let k;
  while ((k = keyRe.exec(clean))) used.delete(k[2]);
  const free = new Set();
  for (const u of used) {
    if (declared.has(u)) continue;
    if (JS_KEYWORDS.has(u)) continue;
    free.add(u);
  }
  return free;
}

module.exports = { auditSource, auditView, report, freeRefs, stripStrings, ROOT };

// ---------------------------------------------------------------- CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  // `--selftest` must come first: never trust a clean sweep from an unproven tool.
  if (args.includes('--selftest')) {
    const probe = '<%- totallyBogusLocalName || 1 %>';
    const r = auditSource(probe);
    const detected = !!(r.names && r.names.has('totallyBogusLocalName'));
    console.log('=== SELF-TEST ===');
    console.log('planted "totallyBogusLocalName" in an in-memory template');
    console.log('detected: ' + detected);
    console.log(detected ? 'SELF-TEST PASS' : 'SELF-TEST FAIL -- instrument is blind');
    process.exit(detected ? 0 : 1);
  }

  const target = args.find((a) => !a.startsWith('-'));
  if (target) {
    const r = auditView(target);
    if (r.missing) { console.log('VIEW MISSING : ' + r.missing); process.exit(2); }
    if (r.compileError) { console.log('COMPILE      : ' + r.compileError); process.exit(2); }
    if (r.modeError) { console.log('AUDIT MODE   : ' + r.modeError); process.exit(2); }
    if (r.extractionError) { console.log('EXTRACTION   : ' + r.extractionError); process.exit(2); }
    console.log('view          : ' + target);
    console.log('required      : ' + [...r.names].sort().join(', '));
    console.log('typeof-guarded: ' + ([...r.optional].sort().join(', ') || '(none)'));
    process.exit(0);
  }

  // No target: delegate to the full sweep, which knows the route contracts.
  const full = path.join(__dirname, 'audit-view-locals.js');
  if (!fs.existsSync(full)) {
    console.error('ERROR: audit-view-locals.js not found next to this shim.');
    console.error('       Copy it from the skill references/ directory.');
    process.exit(2);
  }
  require(full);
}
