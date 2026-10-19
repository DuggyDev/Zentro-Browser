'use strict';
const compat = require('./compat');
/**
 * One browser window.
 *
 * Layout (all native views inside one BaseWindow, stacked bottom to top):
 *   tab pages / sidebar site panel  <  side view (sidebar rail + vertical tabs)  <  top view (tab strip, toolbar, popups)
 * The top view is only as tall as the toolbar; when a popup (menu, suggestions, downloads...) is open it is
 * stretched over the page and drawn on a transparent background.
 */
const path = require('path');
const { BaseWindow, WebContentsView, Menu, dialog, shell, nativeTheme, clipboard } = require('electron');
const { Tab, NEWTAB } = require('./tab');
const { actionFor } = require('../core/shortcuts');
const { resolveInput, displayUrl } = require('../core/urls');
const { openReader } = require('./reader');
const { AiPanel } = require('./ai');

const TAB_H = 40; const TOOLBAR_H = 48; const RAIL_COMPACT = 52; const RAIL_EXPANDED = 190; const VTAB_W = 250; const PANEL_W = 440;
const PRELOAD = path.join(__dirname, '..', '..', 'preload.js');
const ICON = path.join(__dirname, '..', '..', 'pages', 'shared', 'icon.png');

class BrowserWin {
  constructor(app, { isPrivate = false, tabs = null, activeIndex = 0, bounds = null } = {}) {
    this.app = app;
    this.profile = app.profile;
    this.isPrivate = isPrivate;
    this.ses = isPrivate ? app.createPrivateSession() : app.regularSession;
    this.tabs = [];
    this.activeId = null;
    this.closedTabs = [];
    this.extent = 0;
    this.htmlFullscreen = false;
    this.panelId = null;
    this.panelView = null;
    this.permQueue = [];
    this.ai = new AiPanel(this);
    this.stateTimer = null;
    this.excludeFromSession = false;
    this.destroyed = false;
    app.windows.push(this);

    const b = bounds || {};
    this.win = new BaseWindow({
      width: b.width || 1280, height: b.height || 800, x: b.x, y: b.y, minWidth: 720, minHeight: 480, show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0c' : '#f4f4f6', title: 'Zentro Browser', icon: ICON,
      titleBarStyle: 'hidden', titleBarOverlay: this.overlayOptions(),
    });
    if (b.maximized) this.win.maximize();
    this.top = this._ui('top');
    this.side = this._ui('side');
    this.tabsView = this._ui('side', 'strip');       // tab list shown at the bottom or on the right (see Settings > Tab position)
    for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      this.win.on(ev, () => { this.layout(); this.scheduleState(); });
    }
    this.win.on('focus', () => { app.activeWin = this; });
    this.win.on('close', () => this.onClose());
    this.win.on('closed', () => this.onClosed());

    if (tabs && tabs.length) {
      tabs.forEach((t, i) => this.addTab({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, sleeping: i !== activeIndex, background: i !== activeIndex }));
      const t = this.tabs[Math.min(activeIndex, this.tabs.length - 1)];
      if (t) this.activate(t.id);
    } else {
      this.addTab({ url: NEWTAB });
    }
    this.layout();
    this.win.show();
  }

  // ------------------------------------------------------------ views
  _ui(role, page = role) {
    const v = new WebContentsView({
      webPreferences: { session: this.app.uiSession, preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
    });
    v.setBackgroundColor('#00000000');
    this.app.register(v.webContents, { window: this, role });
    this.guard(v.webContents);
    v.webContents.loadURL(`zentro://ui/${page}.html`);
    this.win.contentView.addChildView(v);
    return v;
  }

  /** Keyboard shortcuts, popup handling and navigation limits for every web contents in this window. */
  guard(wc) {
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const a = actionFor(input);
      if (a) { e.preventDefault(); this.runAction(a); }
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^https?:/i.test(url)) this.addTab({ url, background: disposition === 'background-tab', openerId: this.activeId });
      else this.confirmExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      const info = this.app.registry.get(wc.id);
      if (!this.allowNav(url, wc.getURL(), info && info.role)) {
        e.preventDefault();
        if (!/^(https?|zentro|about|file):/i.test(url)) this.confirmExternal(url);
      }
    });
    wc.on('will-attach-webview', (e) => e.preventDefault());
  }

  allowNav(url, cur, role) {
    if (role === 'top' || role === 'side') return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol === 'http:' || u.protocol === 'https:') return true;
    if (u.protocol === 'zentro:') return cur.startsWith('zentro:'); // websites can never open browser pages
    if (u.protocol === 'about:') return u.href === 'about:blank';
    if (u.protocol === 'file:') return cur.startsWith('file:');
    return false;
  }

  async confirmExternal(url) {
    let u;
    try { u = new URL(url); } catch { return; }
    if (!['mailto:', 'tel:'].includes(u.protocol)) return; // everything else is silently blocked
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question', buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Open another app?', message: `A website wants to open a ${u.protocol.replace(':', '')} link.`, detail: url.slice(0, 200),
    });
    if (response === 1) shell.openExternal(url);
  }

  attach(tab) {
    this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(tab.id === this.activeId && !this.destroyed);
    this.raise();
    this.layout();
  }
  raise() {
    if (this.ai && this.ai.open) { this.win.contentView.addChildView(this.ai.site); this.win.contentView.addChildView(this.ai.bar); }
    this.win.contentView.addChildView(this.side);
    this.win.contentView.addChildView(this.tabsView);
    this.win.contentView.addChildView(this.top);
  }

  // ------------------------------------------------------------ layout
  overlayOptions() {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      color: dark ? '#0a0a0c' : '#f4f4f6', symbolColor: dark ? '#f2f2f5' : '#18181b',
      height: this.profile && this.profile.settings.tabLayout !== 'horizontal' ? TOOLBAR_H : TAB_H,
    };
  }
  applyTheme() {
    if (this.destroyed) return;
    try { this.win.setTitleBarOverlay(this.overlayOptions()); } catch { /* not supported here */ }
    this.win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0a0c' : '#f4f4f6');
  }
  onSettingsChanged() {
    if (this.destroyed) return;
    this.applyTheme();
    this.layout();
    this.scheduleState();
  }

  metrics() {
    const s = this.profile.settings;
    // Where the tabs live: top (default), left, right or bottom. Only "top" keeps the strip inside the toolbar view.
    const pos = { horizontal: 'top', vertical: 'left', right: 'right', bottom: 'bottom' }[s.tabLayout] || 'top';
    const rail = s.sidebar.enabled ? (s.sidebar.mode === 'expanded' ? RAIL_EXPANDED : RAIL_COMPACT) : 0;
    return {
      pos, vertical: pos !== 'top', rail, vtabs: pos === 'left' ? VTAB_W : 0, rightW: pos === 'right' ? VTAB_W : 0, bottomH: pos === 'bottom' ? TAB_H : 0,
      topH: pos === 'top' ? TAB_H + TOOLBAR_H : TOOLBAR_H,
    };
  }

  layout() {
    if (this.destroyed || this.win.isDestroyed()) return;
    const { width: W, height: H } = this.win.getContentBounds();
    const m = this.metrics();
    const sideW = m.rail + m.vtabs;
    const t = this.active();
    if (this.htmlFullscreen) {
      this.top.setVisible(false);
      this.side.setVisible(false);
      this.tabsView.setVisible(false);
      if (this.panelView) this.panelView.setVisible(false);
      if (t && t.view) t.view.setBounds({ x: 0, y: 0, width: W, height: H });
      this.ai.place();
      return;
    }
    const extra = this.extent === 'full' ? H : m.topH + (Number(this.extent) || 0);
    this.top.setVisible(true);
    this.top.setBounds({ x: 0, y: 0, width: W, height: Math.max(m.topH, Math.min(H, extra)) });
    const areaH = Math.max(0, H - m.topH - m.bottomH);          // the part between the toolbar and a bottom tab bar
    this.side.setVisible(sideW > 0);
    if (sideW > 0) this.side.setBounds({ x: 0, y: m.topH, width: sideW, height: areaH });
    this.tabsView.setVisible(m.pos === 'right' || m.pos === 'bottom');
    if (m.pos === 'right') this.tabsView.setBounds({ x: Math.max(0, W - m.rightW), y: m.topH, width: m.rightW, height: Math.max(0, H - m.topH) });
    else if (m.pos === 'bottom') this.tabsView.setBounds({ x: 0, y: Math.max(0, H - m.bottomH), width: W, height: m.bottomH });
    const panelW = this.panelView ? Math.min(PANEL_W, Math.max(260, W - sideW - m.rightW - 320)) : 0;
    if (this.panelView) {
      this.panelView.setVisible(true);
      this.panelView.setBounds({ x: sideW, y: m.topH, width: panelW, height: areaH });
    }
    if (t && t.view) t.view.setBounds({ x: sideW + panelW, y: m.topH, width: Math.max(0, W - sideW - panelW - m.rightW), height: areaH });
    this.ai.place();
  }

  setExtent(v) {
    this.extent = v === 'full' ? 'full' : Math.max(0, Math.min(500, Number(v) || 0));
    this.layout();
  }
  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    this.win.setFullScreen(on);
    this.layout();
  }

  // ------------------------------------------------------------ tabs
  active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  byId(id) { return this.tabs.find((t) => t.id === id) || null; }

  addTab({ url = NEWTAB, background = false, pinned = false, title, favicon, sleeping = false, index = null, openerId = null } = {}) {
    const tab = new Tab(this, { id: this.app.nextTabId(), url, title, favicon, pinned, sleeping });
    let at = this.tabs.length;
    if (index !== null) at = index;
    else if (openerId) at = this.tabs.findIndex((t) => t.id === openerId) + 1 || this.tabs.length;
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    at = pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
    this.tabs.splice(at, 0, tab);
    if (!sleeping) tab.create();
    if (!background) this.activate(tab.id, { focusAddress: url === NEWTAB });
    this.changed();
    return tab;
  }

  activate(id, { focusAddress = false } = {}) {
    const t = this.byId(id);
    if (!t) return;
    const prev = this.active();
    if (prev && prev !== t && prev.wc) prev.wc.stopFindInPage('clearSelection');
    this.activeId = id;
    t.lastActive = Date.now();
    if (t.sleeping) t.create();
    for (const x of this.tabs) if (x.view) x.view.setVisible(x === t);
    this.layout();
    if (focusAddress) { this.send('focus-address'); this.top.webContents.focus(); } else if (t.wc) t.wc.focus();
    this.changed();
  }

  closeTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = this.tabs[i];
    if (!this.isPrivate && /^https?:/i.test(t.url)) {
      this.closedTabs.push({ url: t.url, title: t.title, pinned: t.pinned });
      if (this.closedTabs.length > 25) this.closedTabs.shift();
    }
    this.permQueue = this.permQueue.filter((p) => { if (p.tab === t) { p.cb(false, false); return false; } return true; });
    this.tabs.splice(i, 1);
    t.destroyView();
    if (!this.tabs.length) { this.win.close(); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    this.changed();
  }

  closeOthers(id) { for (const t of [...this.tabs]) if (t.id !== id && !t.pinned) this.closeTab(t.id); }
  closeRight(id) { const i = this.tabs.findIndex((t) => t.id === id); for (const t of this.tabs.slice(i + 1)) if (!t.pinned) this.closeTab(t.id); }
  reopenClosed() { const c = this.closedTabs.pop(); if (c) this.addTab({ url: c.url, pinned: c.pinned }); }
  duplicate(id) { const t = this.byId(id); if (t) this.addTab({ url: t.url.startsWith('zentro://error') ? NEWTAB : t.url, openerId: id }); }
  pin(id) {
    const t = this.byId(id);
    if (!t) return;
    t.pinned = !t.pinned;
    this.tabs.splice(this.tabs.indexOf(t), 1);
    const n = this.tabs.filter((x) => x.pinned).length;
    this.tabs.splice(t.pinned ? n : n, 0, t);
    this.changed();
  }
  moveTab(id, index) {
    const t = this.byId(id);
    if (!t) return;
    const n = this.tabs.filter((x) => x.pinned).length;
    const to = t.pinned ? Math.min(index, n - 1) : Math.max(index, n);
    this.tabs.splice(this.tabs.indexOf(t), 1);
    this.tabs.splice(Math.max(0, Math.min(to, this.tabs.length)), 0, t);
    this.changed();
  }
  cycle(d) {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + d + this.tabs.length) % this.tabs.length].id);
  }

  goTyped(text) {
    const r = resolveInput(text, this.profile.settings.searchEngine);
    if (!r) return;
    const t = this.active();
    if (!t) { this.addTab({ url: r.url }); return; }
    t.navigate(r.url);
    if (t.wc) t.wc.focus();
  }
  openInternal(url) {
    const t = this.active();
    if (t && t.url.startsWith('zentro://newtab')) t.navigate(url); else this.addTab({ url, openerId: this.activeId });
  }

  // ------------------------------------------------------------ actions
  runAction(a) {
    const t = this.active();
    if (a === 'ai:toggle') { try { this.ai.toggle(); } catch (e) { this.toast(e.message); } }
    else if (a === 'tab:new') this.addTab({ url: NEWTAB, openerId: this.activeId });
    else if (a === 'tab:close') { if (t) this.closeTab(t.id); }
    else if (a === 'tab:reopen') this.reopenClosed();
    else if (a === 'focus-address') { this.send('focus-address'); this.top.webContents.focus(); }
    else if (a === 'tab:next') this.cycle(1);
    else if (a === 'tab:prev') this.cycle(-1);
    else if (a.startsWith('tab:index:')) { const x = this.tabs[Number(a.slice(10)) - 1]; if (x) this.activate(x.id); }
    else if (a === 'tab:last') this.activate(this.tabs[this.tabs.length - 1].id);
    else if (a === 'reload') { if (t) t.reload(false); }
    else if (a === 'reload:hard') { if (t) t.reload(true); }
    else if (a === 'find') this.send('ui', { open: 'find' });
    else if (a === 'bookmark') this.send('ui', { open: 'bookmark' });
    else if (a === 'menu') this.send('ui', { open: 'menu' });
    else if (a === 'shield') this.send('ui', { open: 'shield' });
    else if (a === 'history') this.openInternal('zentro://history/');
    else if (a === 'downloads') this.send('ui', { open: 'downloads' });
    else if (a === 'clear-data') this.openInternal('zentro://settings/#privacy');
    else if (a === 'window:private') this.app.openWindow({ isPrivate: true });
    else if (a === 'window:new') this.app.openWindow({});
    else if (a === 'back') { if (t) t.back(); }
    else if (a === 'forward') { if (t) t.forward(); }
    else if (a === 'stop') { if (t) t.stop(); }
    else if (a === 'home') { if (t) t.navigate(this.profile.settings.homepage); }
    else if (a === 'fullscreen') this.win.setFullScreen(!this.win.isFullScreen());
    else if (a === 'zoom:in') { if (t) t.setZoom(t.zoom + 0.5); }
    else if (a === 'zoom:out') { if (t) t.setZoom(t.zoom - 0.5); }
    else if (a === 'zoom:reset') { if (t) t.setZoom(0); }
    else if (a === 'print') { if (t && t.wc) t.wc.print(); }
    else if (a === 'devtools') { if (t && t.wc) t.wc.toggleDevTools(); }
    else if (a === 'reader') { if (t) openReader(t).catch((e) => this.toast(e.expose ? e.message : 'Reading mode failed.')); }
    else if (a.startsWith('sidebar:')) { const it = this.profile.settings.sidebar.items[Number(a.slice(8)) - 1]; if (it) this.openSidebarItem(it.id); }
  }

  // ------------------------------------------------------------ find in page
  findStart({ text, forward = true, matchCase = false, next = false }) {
    const t = this.active();
    if (!t || !t.wc) return;
    if (!text) { t.wc.stopFindInPage('clearSelection'); this.send('find-result', { active: 0, total: 0 }); return; }
    t.wc.findInPage(text, { forward, findNext: next, matchCase });
  }
  findStop() { const t = this.active(); if (t && t.wc) t.wc.stopFindInPage('clearSelection'); }

  // ------------------------------------------------------------ sidebar panel
  openSidebarItem(id) {
    const item = this.profile.settings.sidebar.items.find((i) => i.id === id);
    if (!item) return;
    if (item.mode === 'tab') { this.addTab({ url: item.url, openerId: this.activeId }); return; }
    if (this.panelId === id) { this.closePanel(); return; }
    this.closePanel();
    const v = new WebContentsView({
      webPreferences: { session: this.ses, preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    this.app.register(v.webContents, { window: this, role: 'panel' });
    this.guard(v.webContents);
    // Same rule as for tabs: Google's sign-in page needs a different browser name, everything else (WhatsApp, Discord, Gmail...) gets the normal one.
    const wcp = v.webContents;
    const ua = (u) => { try { const want = compat.isGoogleAuth(u) ? compat.FIREFOX_UA : compat.CHROME_UA; if (wcp.getUserAgent() !== want) wcp.setUserAgent(want); } catch { /* closed */ } };
    wcp.on('will-navigate', (_e, u) => ua(u));
    wcp.on('will-redirect', (_e, u) => ua(u));
    ua(item.url);
    wcp.loadURL(item.url).catch(() => {});
    this.panelView = v;
    this.panelId = id;
    this.win.contentView.addChildView(v);
    this.raise();
    this.layout();
    this.changed();
  }
  closePanel() {
    if (!this.panelView) return;
    const v = this.panelView;
    this.panelView = null;
    this.panelId = null;
    try { this.win.contentView.removeChildView(v); } catch { /* detached */ }
    try { v.webContents.close(); } catch { /* closed */ }
    this.layout();
    this.changed();
  }

  // ------------------------------------------------------------ permissions
  askPermission(req, cb) {
    this.permQueue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, origin: req.origin, permission: req.permission, label: req.label, tab: req.tab, cb });
    this.scheduleState();
  }
  answerPermission(id, allow, remember) {
    const i = this.permQueue.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.permQueue.splice(i, 1);
    p.cb(!!allow, !!remember);
    this.scheduleState();
  }

  // ------------------------------------------------------------ native menus
  tabMenu(id) {
    const t = this.byId(id);
    if (!t) return;
    Menu.buildFromTemplate([
      { label: 'New tab to the right', click: () => this.addTab({ url: NEWTAB, openerId: id }) },
      { type: 'separator' },
      { label: 'Reload', click: () => t.reload(false) },
      { label: 'Duplicate', click: () => this.duplicate(id) },
      { label: t.pinned ? 'Unpin tab' : 'Pin tab', click: () => this.pin(id) },
      { label: t.muted ? 'Unmute site' : 'Mute site', click: () => t.setMuted(!t.muted) },
      { label: 'Put tab to sleep', enabled: id !== this.activeId && !t.sleeping, click: () => { t.sleep(); } },
      { type: 'separator' },
      { label: 'Close tab', click: () => this.closeTab(id) },
      { label: 'Close other tabs', click: () => this.closeOthers(id) },
      { label: 'Close tabs to the right', click: () => this.closeRight(id) },
    ]).popup({ window: this.win });
  }

  pageContextMenu(tab, p) {
    const wc = tab.wc;
    if (!wc) return;
    const web = (u) => /^https?:/i.test(u || '');
    const tpl = [];
    if (web(p.linkURL)) {
      tpl.push({ label: 'Open link in new tab', click: () => this.addTab({ url: p.linkURL, background: true, openerId: tab.id }) },
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    if (p.mediaType === 'image' && web(p.srcURL)) {
      tpl.push({ label: 'Open image in new tab', click: () => this.addTab({ url: p.srcURL, openerId: tab.id }) },
        { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
        { label: 'Save image as\u2026', click: () => wc.downloadURL(p.srcURL) }, { type: 'separator' });
    }
    if (p.isEditable) {
      tpl.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste },
        { role: 'selectAll' }, { type: 'separator' });
    } else if (p.selectionText) {
      const q = p.selectionText.trim().slice(0, 100);
      tpl.push({ role: 'copy' }, {
        label: `Search for \u201C${q.length > 28 ? q.slice(0, 28) + '\u2026' : q}\u201D`,
        click: () => this.addTab({ url: resolveInput(q + ' ', this.profile.settings.searchEngine).url, openerId: tab.id }),
      }, { type: 'separator' });
    }
    tpl.push({ label: 'Back', enabled: tab.canBack, click: () => tab.back() }, { label: 'Forward', enabled: tab.canForward, click: () => tab.forward() },
      { label: 'Reload', click: () => tab.reload(false) });
    if (web(tab.url)) tpl.push({ type: 'separator' }, { label: 'Reading mode', click: () => this.runAction('reader') });
    tpl.push({ type: 'separator' }, { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(tpl).popup({ window: this.win });
  }

  // ------------------------------------------------------------ state for the interface
  scheduleState() {
    if (this.stateTimer || this.destroyed) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = null; this.pushState(); }, 40);
  }
  changed() {
    this.scheduleState();
    this.updateTitle();
    this.app.scheduleSessionSave();
  }
  updateTitle() {
    if (this.destroyed || this.win.isDestroyed()) return;
    const t = this.active();
    this.win.setTitle(`${(t && t.title) || 'New tab'} - Zentro Browser${this.isPrivate ? ' (Private)' : ''}`);
  }

  state() {
    const a = this.active();
    const s = this.profile.settings;
    const m = this.metrics();
    return {
      isPrivate: this.isPrivate,
      accent: s.accent,
      engine: s.searchEngine,
      tabs: this.tabs.map((t) => t.info(t.id === this.activeId)),
      activeId: this.activeId,
      nav: a ? {
        canBack: a.canBack, canForward: a.canForward, loading: a.loading, url: a.url, display: displayUrl(a.url),
        security: a.security(), zoom: Math.round(100 * 1.2 ** a.zoom), bookmarked: !!this.profile.findBookmark(a.url),
        readable: /^https?:/i.test(a.url),
      } : null,
      shield: a ? this.app.shield.pageState(a) : null,
      layout: { pos: m.pos, vertical: m.vertical, rail: m.rail, vtabs: m.vtabs, sidebar: { enabled: s.sidebar.enabled, mode: s.sidebar.mode, items: s.sidebar.items, active: this.panelId } },
      downloads: this.app.downloads.summary(),
      prompt: this.permQueue[0] ? { id: this.permQueue[0].id, origin: this.permQueue[0].origin, label: this.permQueue[0].label } : null,
      fullscreen: this.win.isFullScreen(),
    };
  }

  send(channel, payload) {
    if (this.destroyed) return;
    for (const v of [this.top, this.side, this.tabsView]) {
      const wc = v && v.webContents;
      if (wc && !wc.isDestroyed()) wc.send('zentro:event', channel, payload);
    }
  }
  pushState() { this.send('state', this.state()); }
  toast(message) { this.send('toast', { message }); }

  sessionInfo() {
    return {
      tabs: this.tabs.map((t) => {
        let url = t.wc && !t.wc.isDestroyed() ? t.wc.getURL() || t.url : t.url;
        if (url.startsWith('zentro://error')) url = new URL(url).searchParams.get('url') || NEWTAB;
        return { url, title: t.title, pinned: t.pinned, favicon: t.favicon };
      }),
      active: Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId)),
    };
  }

  // ------------------------------------------------------------ closing
  onClose() {
    if (this.isPrivate) return;
    try { this.profile.setBounds({ ...this.win.getNormalBounds(), maximized: this.win.isMaximized() }); } catch { /* ignore */ }
    if (this.app.windows.some((w) => w !== this && !w.isPrivate && !w.destroyed)) this.excludeFromSession = true;
    this.app.saveSessionNow();
  }
  onClosed() {
    this.destroyed = true;
    clearTimeout(this.stateTimer);
    for (const p of this.permQueue) p.cb(false, false);
    this.permQueue = [];
    for (const t of this.tabs) t.destroyView();
    this.ai.destroy();
    if (this.panelView) { try { this.panelView.webContents.close(); } catch { /* closed */ } }
    for (const v of [this.top, this.side, this.tabsView]) { try { v.webContents.close(); } catch { /* closed */ } }
    this.app.windows = this.app.windows.filter((w) => w !== this);
    if (this.isPrivate) this.app.destroyPrivateSession(this.ses);
    if (!this.app.windows.length) this.app.quit();
  }
}

module.exports = { BrowserWin };
