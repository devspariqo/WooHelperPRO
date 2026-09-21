/**
 * Build a status badge for any domain enum.
 * Usage: <%- statusBadge('PAID', C.PAYMENT_STATUS) %>
 * Falls back to a neutral badge for an unknown value so a stale row never
 * crashes the page.
 */
function statusBadge(value, map) {
  const entry = (map && map[value]) || { en: value, tone: 'muted' };
  const label = entry.en || value;
  const tone = entry.tone || 'muted';
  return `<span class="badge badge-${tone}">${label}</span>`;
}

/** Same, but prefers Bangla when the active language is bn. */
function statusBadgeT(value, map, lang) {
  const entry = (map && map[value]) || { en: value, bn: value, tone: 'muted' };
  const label = lang === 'bn' && entry.bn ? entry.bn : entry.en || value;
  return `<span class="badge badge-${entry.tone || 'muted'}">${label}</span>`;
}

/** Progress bar. */
function progressBar(percent, tone) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
    <span class="progress-fill progress-${tone || 'primary'}" style="width:${p}%"></span>
  </div><span class="progress-label">${p}%</span>`;
}

/** Empty-state block. */
function emptyState(message, actionHtml) {
  return `<div class="empty-state">
    <div class="empty-icon" aria-hidden="true">◌</div>
    <p>${message}</p>
    ${actionHtml || ''}
  </div>`;
}

/**
 * Darken (or lighten, with a negative amount) a #rrggbb colour.
 *
 * Used by the layouts to derive a hover shade from the admin-configured accent.
 * Without it `--accent-500` and `--accent-600` would both be the same literal
 * value, so hover states would show no change at all.
 *
 * Returns the input unchanged if it is not a 6-digit hex colour, so a bad value
 * degrades to "no hover shift" rather than emitting broken CSS.
 */
function shade(hex, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const f = amount === undefined ? -0.18 : amount;
  const r = clamp(((n >> 16) & 255) * (1 + f));
  const g = clamp(((n >> 8) & 255) * (1 + f));
  const b = clamp((n & 255) * (1 + f));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolve which logo to show for the active theme.
 *
 * A logo drawn for a light background is usually illegible on a dark one, so each
 * theme has its own slot. Falls back in this order:
 *
 *   theme-specific  ->  the generic logoUrl  ->  '' (caller shows the wordmark)
 *
 * The fallback chain is what lets an operator upload ONE logo and have it work in
 * both themes, rather than seeing a blank brand in one of them.
 */
function logoFor(settings, theme) {
  const s = settings || {};
  const generic = (s.logoUrl || '').trim();
  const light = (s.logoUrlLight || '').trim();
  const dark = (s.logoUrlDark || '').trim();

  if (theme === 'dark') return dark || generic || light || '';
  return light || generic || dark || '';
}

/**
 * Alt text for the active logo. Prefers the explicit alt, then the site name, so
 * the image is never announced as an unlabelled graphic.
 */
function logoAltFor(settings) {
  const s = settings || {};
  return (s.logoAlt || '').trim() || (s.siteName || '').trim() || 'Home';
}

module.exports = { statusBadge, statusBadgeT, progressBar, emptyState, shade, logoFor, logoAltFor };
