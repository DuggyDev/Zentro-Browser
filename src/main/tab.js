'use strict';
/** One browser tab = one WebContentsView with its own renderer process. */
const path = require('path');
const { WebContentsView } = require('electron');
const { displayUrl, isLocalHost } = require('../core/urls');
const compat = require('./compat');

const PRELOAD = path.join(__dirname, '..', '..', 'preload.js');
const NEWTAB = 'zentro://newtab/';

class Tab {
  constructor(win, o) {
    this.win = win;
    this.id = o.id;
    this.url = o.url || NEWTAB;
    this.topUrlHint = this.url;
    this.title = o.title || '';
    this.favicon = o.favicon || null;
    this.pinned = !!o.pinned;
    this.sleeping = !!o.sleeping;
    this.loading = false;
    this.canBack = false;
    this.canForward = false;
    this.audible = false;
    this.muted = false;
    this.blocked = 0;
    this.upgrade = null;
    this.wasUpgraded = false;
    this.insecureFallback = false;
    this.zoom = 0;
    this.lastActive = Date.now();
    this.view = null;
    this.uaAuth = false;
  }

  get wc() { return this.view ? this.view.webContents : null; }
  get topUrl() { return this.topUrlHint || this.url; }

  security() {
    const u = this.url;
    if (u.startsWith('https:')) return this.insecureFallback ? 'insecure' : 'secure';
    if (u.startsWith('http:')) return 'insecure';
    if (u.startsWith('zentro:')) return 'internal';
    return 'local';
  }

  info(active) {
    return {
      id: this.id, title: this.title || (this.url.startsWith('zentro://newtab') ? 'New tab' : displayUrl(this.url) || 'New tab'),
      url: this.url, favicon: this.favicon, loading: this.loading, pinned: this.pinned, audible: this.audible,
      muted: this.muted, sleeping: this.sleeping, active: !!active,
    };
  }

  create() {
    const app = this.win.app;
    this.view = new WebContentsView({
      webPreferences: {
        session: this.win.ses, preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false, spellcheck: true,
      },
    });
    this.sleeping = false;
    const wc = this.view.webContents;
    app.register(wc, { window: this.win, role: 'tab', tab: this });
    this.win.guard(wc);
    app.vpn.applyToContents(wc);

    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!this.win.isPrivate) app.profile.setTitle(this.url, title);
      this.win.changed();
    });
    wc.on('page-favicon-updated', (_e, favs) => {
      const f = (favs || []).find((x) => /^https?:/i.test(x) || (x.startsWith('data:image/') && x.length < 30000));
      if (f) { this.favicon = f; this.win.changed(); }
    });
    wc.on('did-start-loading', () => { this.loading = true; this.win.changed(); });
    wc.on('did-stop-loading', () => { this.loading = false; this._nav(); this.win.changed(); });
    wc.on('will-navigate', (_e, url) => this.applyUa(url));
    wc.on('will-redirect', (_e, url) => this.applyUa(url));
    wc.on('did-start-navigation', (d) => {
      if (!d.isMainFrame || d.isSameDocument) return;
      this.applyUa(d.url);
      this.blocked = 0;
      this.topUrlHint = d.url;
      if (d.url !== this.upgrade?.fallbackFor) this.insecureFallback = false;
    });
    const committed = (url) => {
      this.url = url;
      this.topUrlHint = url;
      this._nav();
      if (!this.win.isPrivate && /^https?:/i.test(url)) app.profile.addVisit(url, wc.getTitle());
      this.win.changed();
    };
    wc.on('did-navigate', (_e, url) => committed(url));
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) committed(url); });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
      if (!isMain || code === -3 || failedUrl.startsWith('zentro://')) return;
      if (this.upgrade && failedUrl.startsWith('https://') && app.profile.settings.shield.httpsFirst) {
        const from = this.upgrade.from;
        this.upgrade = { fallbackFor: from };
        this.insecureFallback = true;
        this.wasUpgraded = false;
        wc.loadURL(from).catch(() => {});
        return;
      }
      this.showError(code, desc, failedUrl);
    });
    wc.on('render-process-gone', (_e, d) => this.showError(-1000, `The page stopped working (${d.reason}).`, this.url));
    wc.on('audio-state-changed', (e) => { this.audible = !!e.audible; this.win.changed(); });
    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(false));
    wc.on('found-in-page', (_e, r) => this.win.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('context-menu', (_e, params) => this.win.pageContextMenu(this, params));
    wc.on('zoom-changed', () => {});
    wc.setAudioMuted(this.muted);
    wc.setZoomLevel(this.zoom);
    wc.loadURL(this.url).catch(() => {});
    this.win.attach(this);
    return this;
  }

  _nav() {
    const h = this.wc && this.wc.navigationHistory;
    this.canBack = !!h && h.canGoBack();
    this.canForward = !!h && h.canGoForward();
  }

  /** Typed or clicked address from the user (already resolved to a URL). */
  navigate(url) {
    if (this.sleeping) this.create();
    this.upgrade = null;
    this.wasUpgraded = false;
    let target = url;
    if (/^http:\/\//i.test(url) && this.win.app.profile.settings.shield.httpsFirst) {
      let host = '';
      try { host = new URL(url).hostname; } catch { /* ignore */ }
      if (!isLocalHost(host)) { this.upgrade = { from: url }; this.wasUpgraded = true; target = 'https://' + url.slice(7); }
    }
    this.url = target;
    this.topUrlHint = target;
    this.applyUa(target);
    this.wc.loadURL(target).catch(() => {});
    this.win.changed();
  }

  /** Google sign-in only accepts a Firefox-style identity from embedded Chromium; every other page gets the normal one. */
  applyUa(url) {
    const auth = compat.isGoogleAuth(url);
    if (auth === this.uaAuth || !this.wc) return;
    this.uaAuth = auth;
    this.wc.setUserAgent(auth ? compat.FIREFOX_UA : compat.CHROME_UA);
  }

  loadInternal(url) { if (this.sleeping) this.create(); this.wc.loadURL(url).catch(() => {}); }

  showError(code, desc, url) {
    const q = new URLSearchParams({ code: String(code), desc: String(desc).replace(/^net::/, ''), url });
    this.loading = false;
    if (this.wc && !this.wc.isDestroyed()) this.wc.loadURL(`zentro://error/?${q}`).catch(() => {});
  }

  reload(hard) {
    if (!this.wc) return;
    if (this.url.startsWith('zentro://error')) {
      const u = new URL(this.url).searchParams.get('url');
      if (u && /^https?:/i.test(u)) { this.navigate(u); return; }
    }
    if (hard) this.wc.reloadIgnoringCache(); else this.wc.reload();
  }
  stop() { if (this.wc) this.wc.stop(); }
  back() { const h = this.wc && this.wc.navigationHistory; if (h && h.canGoBack()) h.goBack(); }
  forward() { const h = this.wc && this.wc.navigationHistory; if (h && h.canGoForward()) h.goForward(); }
  setMuted(m) { this.muted = m; if (this.wc) this.wc.setAudioMuted(m); this.win.changed(); }
  setZoom(z) { this.zoom = Math.max(-3, Math.min(5, z)); if (this.wc) this.wc.setZoomLevel(this.zoom); this.win.changed(); }

  /** Free the renderer process but keep the tab in the strip. */
  sleep() {
    if (this.sleeping || !this.view) return;
    this.url = this.wc.getURL() || this.url;
    this.title = this.wc.getTitle() || this.title;
    this.destroyView();
    this.sleeping = true;
    this.loading = false;
    this.win.changed();
  }

  destroyView() {
    if (!this.view) return;
    const v = this.view;
    this.view = null;
    try { this.win.win.contentView.removeChildView(v); } catch { /* not attached */ }
    try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch { /* already closed */ }
  }
}

module.exports = { Tab, NEWTAB };
