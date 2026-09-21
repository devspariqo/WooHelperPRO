'use strict';

/**
 * Dark-mode contrast check.
 *
 * Resolves the CSS cascade the way a browser would for <html data-theme="dark">
 * and measures the contrast ratio between the foreground and background tokens.
 *
 * Why this exists: the layouts emit an inline <style> AFTER site.css, setting
 * brand tokens on `:root`. `:root` and `[data-theme="dark"]` have the SAME
 * specificity, so anything the inline block sets wins in dark mode too -- even
 * when it is a light-theme value. That is exactly how `--text: #17141f` (the
 * light-theme near-black) once ended up on the near-black dark background and
 * made every page unreadable.
 *
 * The check therefore asserts two things:
 *   1. In dark mode, the inline block must NOT set a token that the dark theme
 *      also defines, unless it is scoped to :root:not([data-theme="dark"]).
 *   2. The resulting text/background pairs must clear WCAG AA (4.5:1).
 *
 * Usage: node scripts/dark-mode-check.js [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

const PAGES = ['/', '/services', '/packages', '/blog', '/contact', '/login', '/register'];

// ---- colour maths ----------------------------------------------------------

function parseHex(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- CSS extraction --------------------------------------------------------

/** Pull the declarations of every block whose selector matches `pred`. */
function declarations(css, pred) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!pred(selector)) continue;
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i === -1) continue;
      const prop = decl.slice(0, i).trim();
      const val = decl.slice(i + 1).trim();
      if (prop.startsWith('--')) out[prop] = val;
    }
  }
  return out;
}

const results = [];
function check(label, pass, detail) {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, html: await res.text() };
}

(async () => {
  console.log(`\nDark-mode contrast check -> ${BASE}\n`);

  // ---- 1. site.css dark palette ----
  const siteCss = await (await fetch(`${BASE}/css/site.css`)).text();
  const darkVars = declarations(siteCss, (s) => s.includes('data-theme="dark"'));

  if (!darkVars['--text'] || !darkVars['--bg']) {
    console.log('FATAL: could not read the dark palette from site.css');
    process.exit(1);
  }

  // ---- 2. inline block must not clobber dark tokens unscoped ----
  let inlineUnscopedClash = [];
  for (const path of PAGES) {
    const { status, html } = await get(path);
    if (status !== 200) { check(`GET ${path}`, false, `status ${status}`); continue; }

    const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const inline = styleBlocks.join('\n');

    // Anything the inline block sets on a bare `:root` will beat the dark theme.
    const bareRoot = declarations(inline, (s) => s.trim() === ':root' || s.trim() === ':root,');
    const clashes = Object.keys(bareRoot).filter((k) => Object.prototype.hasOwnProperty.call(darkVars, k));
    if (clashes.length) inlineUnscopedClash.push(`${path}: ${clashes.join(', ')}`);

    // The light-only scope must be present when the layout overrides text colour.
    const scoped = declarations(inline, (s) => s.includes(':not([data-theme="dark"])'));
    if (Object.keys(scoped).length === 0) {
      inlineUnscopedClash.push(`${path}: no :root:not([data-theme="dark"]) scope at all`);
    }
  }

  check(
    'inline brand tokens do not clobber the dark palette unscoped',
    inlineUnscopedClash.length === 0,
    inlineUnscopedClash.length ? inlineUnscopedClash.join(' | ') : 'no clashes on any page',
  );

  // ---- 3. contrast in dark mode ----
  // Effective value = dark palette, with any light-only scope correctly excluded.
  const text = parseHex(darkVars['--text']);
  const bg = parseHex(darkVars['--bg']);
  const surface = parseHex(darkVars['--surface']);
  const soft = parseHex(darkVars['--text-soft']);
  const mute = parseHex(darkVars['--text-mute']);

  if (!text || !bg) { console.log('FATAL: unparseable dark colours'); process.exit(1); }

  const pairs = [
    ['body text on page background', text, bg, 4.5],
    ['body text on card surface', text, surface, 4.5],
    ['soft text on page background', soft, bg, 4.5],
    ['muted text on page background', mute, bg, 4.5],
  ];

  for (const [label, fg, bgc, min] of pairs) {
    if (!fg || !bgc) { check(label, false, 'unparseable colour'); continue; }
    const ratio = contrast(fg, bgc);
    check(label, ratio >= min, `${ratio.toFixed(2)}:1 (needs ${min})`);
  }

  // ---- 4. the specific regression: --text must be LIGHT in dark mode ----
  const textLum = luminance(text);
  check(
    'dark --text is light, not the light-theme near-black',
    textLum > 0.5,
    `luminance ${textLum.toFixed(3)} (${darkVars['--text']})`,
  );

  console.log('\n' + '='.repeat(58));
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length ? `${failed.length} failure(s)` : 'all dark-mode checks passed');
  process.exit(failed.length ? 1 : 0);
})();
