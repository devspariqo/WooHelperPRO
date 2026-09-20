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

module.exports = { statusBadge, statusBadgeT, progressBar, emptyState };
