'use strict';

/**
 * i18n dictionary lint.
 *
 * Catches the two mistakes that silently break translations:
 *
 *  1. DUPLICATE KEYS. In a JS object literal the last one silently wins, so a
 *     second `Save:` further down the file quietly overrides the first.
 *  2. KEYS WITH SURROUNDING WHITESPACE. The translation wrapper trims captured
 *     text before looking it up, so a key of 'Choose ' (trailing space) never
 *     matches and the string stays English with no error anywhere. This already
 *     bit six strings.
 *
 * It also reports keys never referenced by any view, which are usually typos or
 * leftovers rather than deliberate.
 *
 * Usage: node scripts/lint-i18n.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DICT = path.join(ROOT, 'src', 'config', 'translations.js');

const src = fs.readFileSync(DICT, 'utf8');

// Pull top-level keys: lines like `  Key: 'value',` or `  'Key with space': 'v',`
const KEY_RE = /^\s{2}(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*))\s*:/gm;

const keys = [];
let m;
while ((m = KEY_RE.exec(src))) keys.push(m[1] !== undefined ? m[1] : m[2]);

let failures = 0;

// ---- 1. duplicates ----
const seen = new Map();
const dupes = [];
for (const k of keys) {
  seen.set(k, (seen.get(k) || 0) + 1);
}
for (const [k, n] of seen) if (n > 1) dupes.push(`${k} (x${n})`);

if (dupes.length) {
  failures += dupes.length;
  console.log('FAIL duplicate keys:');
  for (const d of dupes) console.log(`  ${d}`);
} else {
  console.log(`ok   no duplicate keys (${keys.length} entries)`);
}

// ---- 2. untrimmed keys ----
const untrimmed = keys.filter((k) => k !== k.trim());
if (untrimmed.length) {
  failures += untrimmed.length;
  console.log('FAIL keys with surrounding whitespace (these can never match):');
  for (const k of untrimmed) console.log(`  ${JSON.stringify(k)}`);
} else {
  console.log('ok   all keys are trimmed');
}

// ---- 3. keys never used by a view ----
const viewDir = path.join(ROOT, 'views');
const viewSrc = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ejs')) viewSrc.push(fs.readFileSync(p, 'utf8'));
  }
})(viewDir);
const allViews = viewSrc.join('\n');

const unused = keys.filter((k) => !allViews.includes(`t('${k.replace(/'/g, "\\'")}')`));
console.log(`\n     ${unused.length} key(s) not referenced by any view` +
  (unused.length ? ' (usually fine — kept for future use):' : ''));
if (unused.length) console.log('       ' + unused.slice(0, 12).join(', ') + (unused.length > 12 ? ', …' : ''));

console.log('\n' + '='.repeat(58));
console.log(failures ? `${failures} problem(s)` : 'dictionary is clean');
process.exit(failures ? 1 : 0);
