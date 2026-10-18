'use strict';
/** Pick the best site icon (apple-touch-icon preferred) from a page's <link> tags. Pure, no network. */
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function pickIcon(html, baseUrl) {
  let best = null;
  for (const tag of String(html).slice(0, 400000).match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !(rel.includes('icon') && !rel.includes('mask-icon'))) continue;
    if (!a.href) continue;
    let url;
    try { url = new URL(a.href, baseUrl); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const sizes = String(a.sizes || '').toLowerCase();
    const px = sizes === 'any' ? 180 : Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
    const score = (touch ? 400 : 0) + Math.min(px || 32, 512);
    if (!best || score > best.score) best = { url: url.href, score };
  }
  return best ? best.url : null;
}

module.exports = { pickIcon };
