'use strict';
/**
 * Zentro server (zero dependencies, Node 18+).
 *   GET /api/health        -> { ok: true }
 *   GET /api/premium       -> { premium: boolean }       (needs a Firebase ID token)
 *   GET /api/vpn/servers   -> { servers: [...] }         (Premium only)
 *   GET  /api/chat/<room>?after=<id>&epoch=<e> -> { epoch, messages }   (verified account)
 *   POST /api/chat/<room>  { text, name }       -> { message }          (verified account, rate limited)
 * Stripe is the source of truth: nothing is stored here, so it works on free hosting with a wiped disk.
 */
const http = require('http');
const { evaluateSessions } = require('./premium-logic');
const { Chat, ROOMS } = require('./chat-logic');

const PORT = Number(process.env.PORT) || 8787;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const PAYMENT_LINK_ID = process.env.STRIPE_PAYMENT_LINK_ID || ''; // optional: plink_..., finds purchases made with another email
let VPN_SERVERS = [];
try { VPN_SERVERS = JSON.parse(process.env.VPN_SERVERS || '[]'); } catch { console.error('VPN_SERVERS is not valid JSON.'); }

const chat = new Chat();
const cache = new Map();                 // uid -> { at, result }
const hits = new Map();                  // ip  -> { n, reset }
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };

function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, reset: now + 60000 };
  if (now > h.reset) { h.n = 0; h.reset = now + 60000; }
  h.n += 1; hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  return h.n > 60;
}

async function whoIs(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => null);
  const u = r.ok && j && j.users && j.users[0];
  return u ? { uid: u.localId, email: u.email || '', verified: !!u.emailVerified } : null;
}

async function stripeSessions(params) {
  const q = new URLSearchParams(params);
  q.append('expand[]', 'data.subscription');
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions?${q}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`Stripe ${r.status}`);
  return j;
}

async function premiumFor(who) {
  if (!who.verified) return { premium: false, reason: 'email-not-verified' };
  const hit = cache.get(who.uid);
  if (hit && Date.now() - hit.at < 60000) return hit.result;
  let result = evaluateSessions((await stripeSessions({ limit: '100', 'customer_details[email]': who.email })).data, who);
  if (!result.premium && PAYMENT_LINK_ID) {             // paid with a different email: scan this payment link's sessions
    let after = '';
    for (let page = 0; page < 5 && !result.premium; page++) {
      const j = await stripeSessions({ limit: '100', payment_link: PAYMENT_LINK_ID, ...(after ? { starting_after: after } : {}) });
      result = evaluateSessions(j.data.filter((s) => s.client_reference_id === who.uid), who);
      if (!j.has_more || !j.data.length) break;
      after = j.data[j.data.length - 1].id;
    }
  }
  cache.set(who.uid, { at: Date.now(), result });
  if (cache.size > 5000) cache.clear();
  return result;
}

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

async function handleChat(req, res, url) {
  if (!FIREBASE_API_KEY) return send(res, 503, { error: 'server not configured' });
  const m = /^Bearer (.{20,4096})$/.exec(String(req.headers.authorization || ''));
  const who = m && await whoIs(m[1]);
  if (!who) return send(res, 401, { error: 'sign in' });
  if (!who.verified) return send(res, 403, { error: 'verify your email first' });
  const room = decodeURIComponent(url.pathname.slice('/api/chat/'.length));
  if (!ROOMS[room]) return send(res, 404, { error: 'no such room' });
  if (req.method === 'GET') {
    const after = Number(url.searchParams.get('after'));
    return send(res, 200, chat.since(room, Number.isInteger(after) ? after : 0, url.searchParams.get('epoch') || ''));
  }
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: 'bad request' }); }
  const r = chat.add(room, who, body && body.name, body && body.text);
  if (!r.ok) return send(res, r.reason === 'slow' ? 429 : 400, { error: r.reason });
  return send(res, 200, { message: r.message });
}

const server = http.createServer(async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method' });
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/api/health') return send(res, 200, { ok: true });
    if (limited(ip)) return send(res, 429, { error: 'slow down' });
    if (path.startsWith('/api/chat/')) return await handleChat(req, res, url);
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    if (path !== '/api/premium' && path !== '/api/vpn/servers') return send(res, 404, { error: 'not found' });
    if (!FIREBASE_API_KEY || !STRIPE_SECRET_KEY) return send(res, 503, { error: 'server not configured' });
    const m = /^Bearer (.{20,4096})$/.exec(String(req.headers.authorization || ''));
    const who = m && await whoIs(m[1]);
    if (!who) return send(res, 401, { error: 'sign in' });
    const p = await premiumFor(who);
    if (path === '/api/premium') return send(res, 200, p);
    if (!p.premium) return send(res, 402, { error: 'premium required' });
    return send(res, 200, { servers: VPN_SERVERS });
  } catch (err) {
    console.error(err.message);
    send(res, 502, { error: 'upstream' });
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`Zentro server on :${PORT}`));
module.exports = { server };
