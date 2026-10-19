'use strict';
/**
 * Logos for the speed-dial tiles. Each icon is downloaded from the site itself (never from a third-party
 * icon service) the first time a tile is shown, then cached on disk.
 */
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const { pickIcon } = require('../core/favicons-core');
const { sniffImage } = require('../core/images');
const { isLocalHost } = require('../core/urls');
const { CHROME_UA } = require('./compat');

const MISS_MS = 3 * 24 * 3600 * 1000;
const EXT_OK = ['png', 'jpg', 'webp', 'gif', 'ico', 'svg'];

async function readLimited(res, max) {
  const chunks = []; let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error('too large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

class Favicons {
  constructor(dir) { this.dir = dir; this.pending = new Map(); fs.mkdirSync(dir, { recursive: true }); }

  _cached(host) {
    for (const ext of EXT_OK) { const f = path.join(this.dir, `${host}.${ext}`); if (fs.existsSync(f)) return f; }
    return null;
  }

  ensure(host) {
    if (typeof host !== 'string' || !/^[a-z0-9.-]{3,253}$/i.test(host) || !host.includes('.') || isLocalHost(host)) return Promise.resolve(null);
    host = host.toLowerCase();
    const hit = this._cached(host);
    if (hit) return Promise.resolve(hit);
    const miss = path.join(this.dir, `${host}.miss`);
    try { if (Date.now() - fs.statSync(miss).mtimeMs < MISS_MS) return Promise.resolve(null); } catch { /* no marker */ }
    if (!this.pending.has(host)) {
      this.pending.set(host, this._fetch(host).catch(() => null).then((f) => {
        this.pending.delete(host);
        if (!f) { try { fs.writeFileSync(miss, String(Date.now())); } catch { /* ignore */ } }
        return f;
      }));
    }
    return this.pending.get(host);
  }

  async _get(url, max) {
    const res = await net.fetch(url, { headers: { 'User-Agent': CHROME_UA }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return { res, body: await readLimited(res, max) };
  }

  async _fetch(host) {
    const candidates = [];
    try {
      const page = await this._get(`https://${host}/`, 400000);
      const picked = pickIcon(page.body.toString('utf8'), page.res.url || `https://${host}/`);
      if (picked) candidates.push(picked);
    } catch { /* fall back to /favicon.ico */ }
    candidates.push(`https://${host}/favicon.ico`);
    for (const url of candidates) {
      try {
        const { body } = await this._get(url, 400000);
        const ext = sniffImage(body, { svg: true });
        if (!ext) continue;
        const file = path.join(this.dir, `${host}.${ext}`);
        fs.writeFileSync(file, body);
        return file;
      } catch { /* try the next candidate */ }
    }
    return null;
  }
}

module.exports = { Favicons };
