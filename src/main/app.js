'use strict';
/** The browser application: owns the profile, sessions, windows and all shared services. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, session, nativeTheme } = require('electron');
const { Profile } = require('../core/profile');
const { handleSession } = require('./protocol');
const { Shield } = require('./shield');
const { Downloads } = require('./downloads');
const { Permissions } = require('./permissions');
const { Extensions } = require('./extensions');
const { BrowserWin } = require('./window');
const { Wallpapers } = require('./wallpapers');
const { Favicons } = require('./favicons');
const { CHROME_UA } = require('./compat');
const { Account } = require('./account');
const { Avatar } = require('./avatar');
const { Premium } = require('./premium');
const { Vpn } = require('./vpn');
const { Updater } = require('./updater');
const { openGate } = require('./gate');
const { School } = require('./school');
const { ChatClient } = require('./chat');

class ZentroApp {
  constructor() {
    this.userData = app.getPath('userData');
    this.profile = new Profile(path.join(this.userData, 'zentro-profile.json'));
    this.registry = new Map();
    this.windows = [];
    this.activeWin = null;
    this.tabCounter = 0;
    this.uiSession = session.defaultSession;
    this.regularSession = session.fromPartition('persist:zentro');
    this.wallpapers = new Wallpapers(path.join(this.userData, 'wallpapers'));
    this.favicons = new Favicons(path.join(this.userData, 'favicons'));
    this.forceDark = !!global.zentroForceDark;
    this.shield = new Shield(this);
    this.downloads = new Downloads(this);
    this.permissions = new Permissions(this);
    this.extensions = new Extensions(this);
    this.avatar = new Avatar(path.join(this.userData, 'avatar'));
    this.homeLogo = new Avatar(path.join(this.userData, 'homelogo'), 'logo');
    this.account = new Account(path.join(this.userData, 'zentro-account.json'));
    this.premium = new Premium(this);
    this.vpn = new Vpn(this);
    this.updater = new Updater(this);
    this.school = new School(this);
    this.chat = new ChatClient(this);
    this.updateTimer = null;
    this.gate = null;
    this.startArgv = [];
    this.sessionTimer = null;
    this.bcTimers = new Map();
  }

  nextTabId() { return ++this.tabCounter; }

  // ------------------------------------------------------------ sessions
  services() {
    return { wallpaperFile: (id) => this.wallpapers.file(id), faviconFile: (host) => this.favicons.ensure(host), avatar: this.avatar, homeLogo: this.homeLogo };
  }
  _setupUi(ses) {
    handleSession(ses, this.services());
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
  }
  _setupWeb(ses, isPrivate) {
    handleSession(ses, this.services());
    ses.setUserAgent(CHROME_UA);
    this.permissions.attach(ses, isPrivate);
    this.shield.attach(ses, isPrivate);
    this.downloads.attach(ses, isPrivate);
    this.vpn.track(ses);
  }
  createPrivateSession() {
    // A partition name without "persist:" lives in memory only and disappears with the window.
    const ses = session.fromPartition(`private-${crypto.randomUUID()}`);
    this._setupWeb(ses, true);
    return ses;
  }
  destroyPrivateSession(ses) {
    this.vpn.untrack(ses);
    ses.clearStorageData().catch(() => {});
    ses.clearCache().catch(() => {});
  }

  // ------------------------------------------------------------ registry of web contents
  register(wc, info) {
    const id = wc.id;
    info.wc = wc;
    this.registry.set(id, info);
    wc.once('destroyed', () => this.registry.delete(id));
  }
  tabForWebContentsId(id) { const i = this.registry.get(id); return (i && i.tab) || null; }

  /** Send an event to every browser page (zentro://) in every window. Coalesced to avoid floods. */
  broadcast(event, payload) {
    if (event.endsWith('-changed') && payload === undefined) {
      if (this.bcTimers.has(event)) return;
      this.bcTimers.set(event, setTimeout(() => { this.bcTimers.delete(event); this._send(event, undefined); }, 80));
      return;
    }
    this._send(event, payload);
  }
  _send(event, payload) {
    for (const { wc } of this.registry.values()) {
      if (!wc.isDestroyed() && wc.getURL().startsWith('zentro://')) wc.send('zentro:event', event, payload);
    }
  }
  pushAllStates() { for (const w of this.windows) w.scheduleState(); }

  // ------------------------------------------------------------ appearance
  onProfileChanged(topic) {
    if (topic === 'settings') {
      nativeTheme.themeSource = this.profile.settings.theme;
      for (const w of this.windows) w.onSettingsChanged();
      this.broadcast('settings-changed');
    } else {
      this.broadcast(`${topic}-changed`);
      if (topic === 'bookmarks' || topic === 'stats') this.pushAllStates();
    }
  }

  // ------------------------------------------------------------ windows and session
  openWindow(opts = {}) { return new BrowserWin(this, opts); }

  saveSessionNow() {
    if (!this.windows.length) return;
    const list = this.windows.filter((w) => !w.isPrivate && !w.excludeFromSession && !w.destroyed).map((w) => w.sessionInfo());
    if (list.length) this.profile.setSession(list);
  }
  scheduleSessionSave() {
    if (this.sessionTimer) return;
    this.sessionTimer = setTimeout(() => { this.sessionTimer = null; this.saveSessionNow(); }, 2000);
    if (this.sessionTimer.unref) this.sessionTimer.unref();
  }

  sleepTabs() {
    const s = this.profile.settings.sleep;
    if (!s.enabled) return;
    const limit = Date.now() - s.minutes * 60000;
    for (const w of this.windows) {
      for (const t of w.tabs) {
        if (t.id !== w.activeId && t.view && !t.audible && !t.loading && t.lastActive < limit) t.sleep();
      }
    }
  }

  async start(argv) {
    nativeTheme.themeSource = this.profile.settings.theme;
    this._setupUi(this.uiSession);
    this._setupWeb(this.regularSession, false);
    await this.extensions.init();
    this.profile.on('changed', (t) => this.onProfileChanged(t));
    nativeTheme.on('updated', () => { for (const w of this.windows) w.applyTheme(); });
    this.sleepTimer = setInterval(() => this.sleepTabs(), 60000);
    this.flushTimer = setInterval(() => this.flushWeb().catch(() => {}), 20000);
    this.startArgv = argv;

    // 1. Is there a newer version? Then only the "you need to update" screen opens.
    const [upd] = await Promise.all([this.updater.check(), this.account.restore().catch(() => {})]);
    if (upd.required) { this.gate = openGate(this, 'update'); return; }
    this.updateTimer = setInterval(() => this.checkUpdateWhileRunning(), 15 * 60000);   // someone who keeps the browser open still gets the update screen
    if (this.updateTimer.unref) this.updateTimer.unref();

    // 2. Signed in before? Bring the VPN back BEFORE any page loads, so nothing goes out unprotected.
    if (this.account.signedIn()) {
      if (this.vpn.wantsRestore()) await this.vpn.restore();
      else this.premium.refresh().catch(() => {});
    }

    // 3. Not signed in yet: show the sign-in screen first.
    if (this.account.shouldPrompt()) { this.gate = openGate(this, 'login'); return; }
    this.openStartupWindows(argv);
    if (this.vpn.restoreFailed) setTimeout(() => { const w = this.windows[0]; if (w) w.toast('The VPN could not reconnect. It is off.'); }, 1500);
  }

  /** Called every 15 minutes: when a newer version exists, the update screen appears on top of the browser. */
  async checkUpdateWhileRunning() {
    if (this.gate && !this.gate.isDestroyed()) return;
    if (this.updateShown && !this.updateShown.isDestroyed()) return;
    const r = await this.updater.check().catch(() => ({ required: false }));
    if (r.required) this.updateShown = openGate(this, 'update', { runtime: true });
  }

  /** The sign-in screen is done (signed in or skipped): open the browser, then close the screen. */
  finishGate() {
    const g = this.gate;
    if (!g) return;
    this.gate = null;
    this.openStartupWindows(this.startArgv);
    if (!g.isDestroyed()) g.close();
  }

  openStartupWindows(argv) {
    const urls = argv.filter((a) => /^https?:\/\//i.test(a)).slice(0, 10);
    const s = this.profile.settings;
    const b = this.profile.bounds;
    const bounds = b && Number.isFinite(b.width) && b.width >= 600 && b.height >= 400 ? b : null;
    if (urls.length) { this.openWindow({ tabs: urls.map((url) => ({ url })), bounds }); return; }
    if (s.startup === 'restore') {
      const wins = this.profile.getSession().windows || [];
      if (wins.length) { wins.forEach((w, i) => this.openWindow({ tabs: w.tabs, activeIndex: w.active, bounds: i === 0 ? bounds : null })); return; }
    }
    if (s.startup === 'homepage' && s.homepage !== 'zentro://newtab/') { this.openWindow({ tabs: [{ url: s.homepage }], bounds }); return; }
    this.openWindow({ bounds });
  }

  /** Called when a second copy of the browser is started (for example from a link). */
  handleSecondInstance(argv) {
    if (this.gate && !this.gate.isDestroyed()) { if (this.gate.isMinimized()) this.gate.restore(); this.gate.focus(); return; }
    const urls = argv.filter((a) => /^https?:\/\//i.test(a)).slice(0, 10);
    const w = this.activeWin && !this.activeWin.destroyed ? this.activeWin : this.windows[0];
    if (!w) { this.openStartupWindows(argv); return; }
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
    urls.forEach((u) => w.addTab({ url: u }));
  }

  quit() { app.quit(); }

  /**
   * Writes cookies and site data to disk. Chromium only does this every ~30 s by itself, so a quick quit lost
   * the newest cookies (Google refreshes its sign-in cookies often) and people got logged out after a few days.
   */
  async flushWeb() {
    const ses = this.regularSession;
    const done = Promise.allSettled([ses.cookies.flushStore(), ses.flushStorageData()]);
    await Promise.race([done, new Promise((r) => setTimeout(r, 2500))]);
  }

  shutdown() {
    this.school.flush();
    this.saveSessionNow();
    this.shield.flushStats();
    this.profile.flush();
  }
}

module.exports = { ZentroApp };
