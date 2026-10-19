'use strict';
/** Version helpers for the "you need to update" check. Pure, no Electron. */

/** "v1.2.3", "1.2", "1.2.3-beta.1" -> [1,2,3] ; anything unreadable -> null. */
function parseVersion(v) {
  const m = /^\s*v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+].*)?\s*$/i.exec(String(v == null ? '' : v));
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

/** -1 | 0 | 1, or null when either side is unreadable. */
function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** True only when `latest` is certainly newer than `current`. Unreadable versions never block anyone. */
const isOutdated = (current, latest) => compareVersions(current, latest) === -1;

/** "owner/repo" -> true. The placeholder from config.js counts as "not configured". */
function isRepoConfigured(repo) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(String(repo || '')) && !/^YOUR-NAME\//i.test(repo);
}

/** Picks what the update screen should show from a GitHub "latest release" API response. */
function readRelease(json, repo) {
  if (!json || typeof json !== 'object' || typeof json.tag_name !== 'string' || !parseVersion(json.tag_name)) return null;
  const exe = Array.isArray(json.assets) ? json.assets.find((a) => a && /\.exe$/i.test(String(a.name)) && typeof a.browser_download_url === 'string') : null;
  const safe = (u) => typeof u === 'string' && u.startsWith(`https://github.com/${repo}/`) ? u : null;
  return {
    version: json.tag_name.replace(/^v/i, ''),
    name: typeof json.name === 'string' ? json.name.slice(0, 120) : '',
    url: safe(exe && exe.browser_download_url) || safe(json.html_url) || `https://github.com/${repo}/releases/latest`,
  };
}

module.exports = { parseVersion, compareVersions, isOutdated, isRepoConfigured, readRelease };
