'use strict';
/** Validation of the VPN (proxy) server list that the Zentro server hands to Premium users. Pure, no Electron. */
const SCHEMES = ['https', 'http', 'socks5'];
const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

function sanitizeServers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list.slice(0, 50)) {
    if (!s || typeof s !== 'object') continue;
    const port = Number(s.port);
    if (typeof s.id !== 'string' || !ID_RE.test(s.id) || seen.has(s.id)) continue;
    if (!SCHEMES.includes(s.scheme) || typeof s.host !== 'string' || !HOST_RE.test(s.host)) continue;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    seen.add(s.id);
    out.push({
      id: s.id, name: String(s.name || s.host).slice(0, 60), country: String(s.country || '').slice(0, 60),
      scheme: s.scheme, host: s.host.toLowerCase(), port,
      username: typeof s.username === 'string' ? s.username.slice(0, 200) : '', password: typeof s.password === 'string' ? s.password.slice(0, 200) : '',
    });
  }
  return out;
}

/** Chromium proxy rule that sends ALL traffic through the server (no direct fallback, so no silent leaks). */
const proxyRule = (s) => `${s.scheme}://${s.host}:${s.port}`;

/** What the interface may see: never the credentials. */
const publicServer = (s) => ({ id: s.id, name: s.name, country: s.country });

module.exports = { sanitizeServers, proxyRule, publicServer, SCHEMES };
