'use strict';
/** fetch with a timeout and JSON handling. Errors from here are never shown raw to the user. */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout), redirect: 'error' });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json };
}
module.exports = { fetchJson };
