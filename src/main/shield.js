'use strict';
/**
 * Zentro Shield: blocks requests to known ad/tracking domains (third-party only), optionally strips
 * third-party cookies, and keeps honest per-page counters. It does NOT do cosmetic filtering, fingerprint
 * protection or anything beyond what is listed in Settings.
 */
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { Blocklist } = require('../core/shield-core');
const { isThirdParty, hostOf } = require('../core/urls');
const compat = require('./compat');

const LIST_URL = 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext';

class Shield {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = new Blocklist();
    this.pending = 0;
    this.userFile = path.join(app.getPath('userData'), 'shield-filters.txt');
    this.loadLists();
    this.timer = setInterval(() => this.flushStats(), 2000);
    if (this.timer.unref) this.timer.unref();
  }

  loadLists() {
    const list = new Blocklist();
    for (const f of [path.join(__dirname, '..', '..', 'data', 'trackers.txt'), this.userFile]) {
      try { list.addText(fs.readFileSync(f, 'utf8')); } catch { /* optional file */ }
    }
    this.list = list;
  }

  flushStats() {
    if (!this.pending) return;
    this.ctx.profile.addBlocked(this.pending);
    this.pending = 0;
  }

  /** Context of a request: which tab/page it belongs to and what protection applies. null = leave alone. */
  _ctxFor(details, isPrivate) {
    const s = this.ctx.profile.settings.shield;
    if (!s.enabled || details.resourceType === 'mainFrame') return null;
    const tab = this.ctx.tabForWebContentsId(details.webContentsId);
    if (!tab) return null;
    const top = tab.topUrl;
    if (!/^https?:/i.test(top)) return null;
    const topHost = hostOf(top);
    if (s.siteOff.includes(topHost)) return null;
    let reqHost;
    try { reqHost = new URL(details.url).hostname; } catch { return null; }
    return {
      s, tab, reqHost,
      thirdParty: isThirdParty(reqHost, topHost),
      blockCookies: s.thirdPartyCookies === 'block' || (isPrivate && s.blockThirdPartyInPrivate),
    };
  }

  attach(ses, isPrivate) {
    const wr = ses.webRequest;
    wr.onBeforeRequest((details, cb) => {
      // School Mode: closed sites never load (main page only), in every window.
      if (details.resourceType === 'mainFrame' && this.ctx.school && this.ctx.school.blocks(details.url)) return cb({ cancel: true });
      const c = this._ctxFor(details, isPrivate);
      if (c && c.s.blockTrackers && c.thirdParty && /^(https?|wss?):/i.test(details.url) && this.list.matches(c.reqHost)) {
        c.tab.blocked++;
        this.pending++;
        c.tab.win.scheduleState();
        return cb({ cancel: true });
      }
      return cb({});
    });
    wr.onBeforeSendHeaders((details, cb) => {
      let h = compat.googleAuthHeaders(details.url, details.requestHeaders);
      const c = this._ctxFor(details, isPrivate);
      if (c && c.thirdParty && c.blockCookies) {
        h = h || { ...details.requestHeaders };
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') delete h[k];
      }
      return cb(h ? { requestHeaders: h } : {});
    });
    wr.onHeadersReceived((details, cb) => {
      const c = this._ctxFor(details, isPrivate);
      if (c && c.thirdParty && c.blockCookies && details.responseHeaders) {
        const h = { ...details.responseHeaders };
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') delete h[k];
        return cb({ responseHeaders: h });
      }
      return cb({});
    });
  }

  /** What the address-bar shield button and panel show for a tab. */
  pageState(tab) {
    const s = this.ctx.profile.settings.shield;
    const url = tab.url || '';
    const web = /^https?:/i.test(url);
    const host = web ? hostOf(url) : '';
    return {
      web, host,
      enabled: s.enabled,
      siteOff: web && s.siteOff.includes(host),
      active: s.enabled && web && !s.siteOff.includes(host),
      blocked: tab.blocked,
      blockTrackers: s.blockTrackers,
      cookies: s.thirdPartyCookies === 'block' || (tab.win.isPrivate && s.blockThirdPartyInPrivate) ? 'blocked' : 'allowed',
      httpsFirst: s.httpsFirst,
      upgraded: tab.url.startsWith('https:') && tab.wasUpgraded,
      insecureFallback: tab.insecureFallback,
      listSize: this.list.size,
    };
  }

  toggleSite(host) {
    if (!/^[a-z0-9.-]{1,253}$/i.test(host)) return;
    const cur = new Set(this.ctx.profile.settings.shield.siteOff);
    if (cur.has(host)) cur.delete(host); else cur.add(host);
    this.ctx.profile.updateSettings({ shield: { siteOff: [...cur] } });
  }

  async updateLists() {
    const res = await net.fetch(LIST_URL);
    if (!res.ok) throw Object.assign(new Error(`The filter list server answered ${res.status}.`), { expose: true });
    const text = await res.text();
    if (text.length > 8 * 1024 * 1024) throw Object.assign(new Error('The filter list is unexpectedly large.'), { expose: true });
    const test = new Blocklist();
    const n = test.addText(text);
    if (n < 500) throw Object.assign(new Error('The downloaded list looks invalid, so it was not used.'), { expose: true });
    fs.writeFileSync(this.userFile, text, 'utf8');
    this.loadLists();
    this.ctx.profile.setFilters({ at: Date.now(), count: n });
    return { count: n, total: this.list.size };
  }
}

module.exports = { Shield };
