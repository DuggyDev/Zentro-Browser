'use strict';
/**
 * The floating AI assistant. Two native views float over the page:
 *   bar  - Zentro's own header (provider tabs, share buttons, drag handle)
 *   site - the AI's real website (ChatGPT, Claude, Gemini, Grok or your own link), signed in with YOUR account there
 * Nothing is sent to an AI automatically. "Share" puts the page text, your selection or a screenshot into the AI's
 * message box when you press the button; you still press Send yourself.
 */
const path = require('path');
const { WebContentsView, clipboard } = require('electron');
const compat = require('./compat');
const { providerList, currentProvider, SIZES, BAR_H, defaultRect, clampRect, buildPrompt } = require('../core/ai');

const PRELOAD = path.join(__dirname, '..', '..', 'preload.js');
const fail = (m) => Object.assign(new Error(m), { expose: true });

// Fixed scripts: no page text or user input is ever placed inside them.
const EXTRACT = `(() => {
  const sel = String(getSelection() || '').slice(0, 20000);
  const root = document.querySelector('article, main') || document.body;
  const text = ((root && root.innerText) || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 20000);
  return { selection: sel, text };
})()`;
const FOCUS_INPUT = `(() => {
  const c = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter((e) => e.offsetParent !== null);
  const e = c[0];
  if (e) { e.focus(); return true; }
  return false;
})()`;

// Fixed script (no page text or user input inside): clicks the "Continue with Google" button on an AI's sign-in page.
const CLICK_GOOGLE = `(() => {
  const words = /(continue|sign in|sign up|log in|login|doorgaan|inloggen|aanmelden|verder)/i;
  const els = [...document.querySelectorAll('button, a, [role="button"]')].filter((e) => e.offsetParent !== null);
  const hit = els.find((e) => { const t = String(e.innerText || e.getAttribute('aria-label') || '').trim(); return t.length > 0 && t.length < 60 && /google/i.test(t) && words.test(t); });
  if (hit) { hit.click(); return true; }
  return false;
})()`;

// Fixed script: is this one of the short "too many requests / authentication error" pages?
const LOOKS_RATE_LIMITED = `(() => { const t = String((document.body && document.body.innerText) || ''); return t.length < 1500 && /rate_limit_exceeded|too many requests|te veel verzoeken/i.test(t); })()`;
// Sign-in data that "Repair sign-in" removes (only for the assistant that is open). Gemini uses Google, so it is left alone.
const RESET_DOMAINS = { chatgpt: ['chatgpt.com', 'openai.com'], claude: ['claude.ai', 'anthropic.com'], grok: ['grok.com', 'x.ai'] };

class AiPanel {
  constructor(win) {
    this.win = win;
    this.open = false;
    this.bar = null;
    this.site = null;
    this.rect = null;
    this.size = 'm';
    this.providerId = null;
    this.loading = false;
    this.anim = null;
    this.extra = 0;
    this.googleUntil = 0;
    this.googleClicks = 0;
    this.navTimes = [];            // recent page loads, to spot a redirect loop
    this.cooldownUntil = 0;        // while set, Zentro does not hit this assistant's sign-in again
    this.cooldownProvider = null;
    this.loadTimer = null;
    this.notice = null;
  }

  get settings() { return this.win.profile.settings; }
  get enabled() { return !!this.settings.ai.enabled; }

  state() {
    const list = providerList(this.settings.ai);
    const cur = this.providerId && list.find((p) => p.id === this.providerId) || currentProvider(this.settings.ai);
    return { open: this.open, provider: cur.id, providers: list.map((p) => ({ id: p.id, name: p.name, host: p.host })), loading: this.loading, size: this.size, private: this.win.isPrivate, notice: this.notice };
  }
  push() {
    for (const v of [this.bar, this.win.top]) if (v && !v.webContents.isDestroyed()) v.webContents.send('zentro:event', 'ai-state', this.state());
  }

  // ------------------------------------------------------------ open / close
  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    if (!this.enabled) throw fail('The AI assistant is turned off in Settings.');
    if (this.open) { this.win.win.contentView.addChildView(this.bar); this.win.raise(); return; }
    const cur = currentProvider(this.settings.ai);
    this.providerId = cur.id;
    this.bar = this._view('ai', 'zentro://ui/ai.html', true);
    this.site = this._view('aisite', null, false);
    this._loadSite(cur);
    this.open = true;
    const { W, H, topH } = this._dims();
    this.rect = this.rect ? clampRect(this.rect, W, H, topH) : defaultRect(this.size, W, H, topH);
    this.win.win.contentView.addChildView(this.site);
    this.win.win.contentView.addChildView(this.bar);
    this.win.raise();
    this.place(true);
    this.push();
    this.win.send('ui', { ai: this.state() });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.anim);
    clearTimeout(this.loadTimer);
    this.loading = false;
    for (const v of [this.bar, this.site]) {
      if (!v) continue;
      try { this.win.win.contentView.removeChildView(v); } catch { /* detached */ }
      try { v.webContents.close(); } catch { /* closed */ }
    }
    this.bar = null; this.site = null;
    this.win.send('ui', { ai: this.state() });
    this.push();
  }
  destroy() { this.close(); }

  _view(role, url, withPreload) {
    const v = new WebContentsView({
      webPreferences: {
        session: withPreload ? this.win.app.uiSession : this.win.ses, ...(withPreload ? { preload: PRELOAD } : {}),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: !withPreload,
      },
    });
    v.setBackgroundColor(withPreload ? '#00000000' : '#0a0a0c');
    try { v.setBorderRadius(14); } catch { /* older Electron */ }
    const wc = v.webContents;
    this.win.app.register(wc, { window: this.win, role });
    this.win.guard(wc);
    if (url) wc.loadURL(url).catch(() => {});
    if (!withPreload) {
      this.win.app.vpn.applyToContents(wc);
      const ua = (u) => { try { const want = compat.isGoogleAuth(u) ? compat.FIREFOX_UA : compat.CHROME_UA; if (wc.getUserAgent() !== want) wc.setUserAgent(want); } catch { /* gone */ } };
      wc.on('will-navigate', (_e, u) => ua(u));
      wc.on('will-redirect', (_e, u) => ua(u));
      wc.on('did-finish-load', () => this._tryGoogle());
      wc.on('did-navigate-in-page', () => this._tryGoogle());
      // The red dot only follows the main page (not hidden frames), and never stays on for more than 15 seconds.
      wc.on('did-start-navigation', (e) => { if (!e.isMainFrame || e.isSameDocument || e.isInPlace) return; this._setLoading(true); this._noteNavigation(wc); });
      wc.on('did-stop-loading', () => { if (!wc.isLoadingMainFrame()) this._setLoading(false); });
      wc.on('did-fail-load', (_e, _c, _d, _u, isMain) => { if (isMain) this._setLoading(false); });
      wc.on('did-finish-load', () => this._checkRateLimit(wc));
      wc.on('render-process-gone', () => this._setLoading(false));
    }
    return v;
  }
  _loadSite(p, url = p.url) {
    this.providerId = p.id;
    if (this._cooling(p)) { this.push(); return false; }
    if (this.site.webContents.getUserAgent() !== compat.CHROME_UA) this.site.webContents.setUserAgent(compat.CHROME_UA);
    this.site.webContents.loadURL(url).catch(() => {});
    this.push();
    return true;
  }

  // ------------------------------------------------------------ keeping the assistant from hammering its own sign-in
  _setLoading(v) {
    clearTimeout(this.loadTimer);
    this.loading = v;
    if (v) this.loadTimer = setTimeout(() => { this.loading = false; this.push(); }, 15000);
    this.push();
  }
  _tell(text) { this.notice = { id: Date.now(), text }; this.push(); }
  _cooling(p) {
    const left = this.cooldownUntil - Date.now();
    if (left <= 0 || this.cooldownProvider !== p.id) return false;
    this._tell(`${p.name} is limiting sign-in attempts. Wait about ${Math.ceil(left / 60000)} more minute(s) before trying again, otherwise it takes longer.`);
    return true;
  }
  /** Eight page loads within 20 seconds is a redirect loop: stop it and leave the assistant alone for a while. */
  _noteNavigation(wc) {
    const now = Date.now();
    this.navTimes = this.navTimes.filter((t) => now - t < 20000);
    this.navTimes.push(now);
    if (this.navTimes.length < 8) return;
    this.navTimes = [];
    this.cooldownUntil = now + 10 * 60000;
    this.cooldownProvider = this.providerId;
    wc.loadURL('about:blank').catch(() => {});
    this._setLoading(false);
    this._tell('This assistant kept redirecting, so Zentro stopped it. Press the wrench to repair the sign-in, wait a few minutes, then try again.');
  }
  _checkRateLimit(wc) {
    if (wc.isDestroyed() || !/^https:/.test(wc.getURL())) return;
    wc.executeJavaScript(LOOKS_RATE_LIMITED).then((limited) => {
      if (!limited || !this.open) return;
      this.cooldownUntil = Date.now() + 15 * 60000;
      this.cooldownProvider = this.providerId;
      this._tell('The assistant says there were too many sign-in attempts. Wait about 15 minutes, then try again. Pressing it again now only makes the wait longer.');
    }).catch(() => {});
  }

  /** The wrench: removes this assistant's saved sign-in data (stale cookies are the usual cause of authentication loops). */
  async fixLogin() {
    if (!this.open || !this.site) throw fail('Open the assistant first.');
    const p = providerList(this.settings.ai).find((x) => x.id === this.providerId) || currentProvider(this.settings.ai);
    let domains = RESET_DOMAINS[p.id];
    if (!domains && p.id === 'custom') domains = [p.host];
    if (!domains || !domains.length) throw fail(`${p.name} uses your Google account, so there is nothing to repair here. Sign in or out on Google itself.`);
    const ses = this.win.ses;
    this.site.webContents.loadURL('about:blank').catch(() => {});
    for (const d of domains) {
      const list = await ses.cookies.get({ domain: d }).catch(() => []);
      for (const c of list) await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${String(c.domain).replace(/^\./, '')}${c.path}`, c.name).catch(() => {});
      await ses.clearStorageData({ origin: `https://${d}` }).catch(() => {});
      await ses.clearStorageData({ origin: `https://www.${d}` }).catch(() => {});
    }
    this.navTimes = [];
    if (this.cooldownUntil > Date.now() && this.cooldownProvider === p.id) {
      this._tell(`Cleared ${p.name}'s sign-in data. Wait about ${Math.ceil((this.cooldownUntil - Date.now()) / 60000)} minute(s), then press New chat and sign in again.`);
      return true;
    }
    this.cooldownUntil = 0;
    this._loadSite(p, p.login || p.url);
    this._tell(`Cleared ${p.name}'s sign-in data. Sign in again (use the Google button if you use Google).`);
    return true;
  }

  /**
   * "Log in with Google" for the assistant that is open. Zentro opens that AI's sign-in page and presses its
   * "Continue with Google" button once or twice (never in a loop, so the AI's own rate limit is not triggered).
   * Google's own page (account choice, password, 2-step) is always left to you.
   */
  loginWithGoogle() {
    if (!this.open || !this.site) throw fail('Open the assistant first.');
    const p = providerList(this.settings.ai).find((x) => x.id === this.providerId) || currentProvider(this.settings.ai);
    if (this._cooling(p)) return false;
    this.googleUntil = Date.now() + 90000;
    this.googleClicks = 0;
    this._loadSite(p, p.login || p.url);
    return true;
  }
  _tryGoogle() {
    if (!this.open || !this.site || Date.now() > this.googleUntil || this.googleClicks >= 2) return;
    const wc = this.site.webContents;
    if (wc.isDestroyed() || compat.isGoogleAuth(wc.getURL())) return;
    setTimeout(() => {
      if (!this.open || !this.site || wc.isDestroyed() || Date.now() > this.googleUntil || this.googleClicks >= 2) return;
      wc.executeJavaScript(CLICK_GOOGLE).then((ok) => { if (ok) this.googleClicks += 1; }).catch(() => {});
    }, 1200);
  }

  setProvider(id) {
    const p = providerList(this.settings.ai).find((x) => x.id === id);
    if (!p) throw fail('Unknown assistant.');
    this.win.profile.updateSettings({ ai: { provider: p.id } });
    if (this.open) this._loadSite(p);
    this.win.app.broadcast('settings-changed');
  }
  newChat() { if (this.open) this._loadSite(providerList(this.settings.ai).find((p) => p.id === this.providerId) || currentProvider(this.settings.ai)); }
  reload() { if (this.open && this.site && !this._cooling(providerList(this.settings.ai).find((p) => p.id === this.providerId) || currentProvider(this.settings.ai))) this.site.webContents.reload(); }

  // ------------------------------------------------------------ geometry
  _dims() {
    const { width: W, height: H } = this.win.win.getContentBounds();
    return { W, H, topH: this.win.metrics().topH };
  }
  place(animate = false) {
    if (!this.open || !this.bar || this.win.destroyed) return;
    const visible = !this.win.htmlFullscreen;
    this.bar.setVisible(visible); this.site.setVisible(visible);
    if (!visible) return;
    const { W, H, topH } = this._dims();
    this.rect = clampRect(this.rect, W, H, topH);
    const apply = (dy) => {
      const r = this.rect;
      this.bar.setBounds({ x: r.x, y: r.y + dy, width: r.w, height: BAR_H + this.extra });
      this.site.setBounds({ x: r.x, y: r.y + dy + BAR_H - 16, width: r.w, height: r.h - BAR_H + 16 });
    };
    clearInterval(this.anim);
    if (animate && this.settings.animations) {            // slide up and settle
      let i = 0; const steps = 10;
      apply(36);
      this.anim = setInterval(() => {
        i += 1;
        const k = 1 - (1 - i / steps) ** 3;
        apply(Math.round(36 * (1 - k)));
        if (i >= steps) clearInterval(this.anim);
      }, 16);
    } else apply(0);
  }
  setExtra(n) { this.extra = Math.max(0, Math.min(300, Math.round(Number(n) || 0))); this.place(); }
  move(dx, dy) {
    if (!this.open) return;
    this.rect = { ...this.rect, x: this.rect.x + Number(dx || 0), y: this.rect.y + Number(dy || 0) };
    this.place();
  }
  resize(size) {
    if (!SIZES[size]) throw fail('Unknown size.');
    this.size = size;
    const r = this.rect; const s = SIZES[size];
    this.rect = { x: r.x + r.w - s.w, y: r.y + r.h - s.h, w: s.w, h: s.h }; // grows from the bottom-right corner
    this.place();
    this.push();
  }

  // ------------------------------------------------------------ sharing what you see
  async _focusPrompt() {
    const wc = this.site.webContents;
    const ok = await wc.executeJavaScript(FOCUS_INPUT).catch(() => false);
    if (!ok) throw fail('Click the message box in the assistant first, then press Share again.');
    wc.focus();
  }

  async share(kind) {
    if (!this.open) throw fail('Open the assistant first.');
    if (!['page', 'selection', 'screenshot'].includes(kind)) throw fail('Unknown share option.');
    const tab = this.win.active();
    if (!tab || !tab.wc || tab.wc.isDestroyed() || !/^https?:/i.test(tab.url)) throw fail('Open a web page first. Browser pages cannot be shared.');
    if (kind === 'screenshot') {
      const img = await tab.wc.capturePage();
      const prev = clipboard.readText();
      clipboard.writeImage(img);
      await this._focusPrompt();
      this.site.webContents.paste();
      setTimeout(() => { if (prev) clipboard.writeText(prev); }, 800); // give the clipboard text back
      return true;
    }
    const data = await tab.wc.executeJavaScript(EXTRACT);
    if (kind === 'selection' && !(data && data.selection)) throw fail('Select some text on the page first.');
    await this._focusPrompt();
    this.site.webContents.insertText(buildPrompt({ kind, title: tab.title, url: tab.url, selection: data.selection, text: data.text }));
    return true;
  }
}

module.exports = { AiPanel };
