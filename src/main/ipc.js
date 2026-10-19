'use strict';
/**
 * The single doorway between browser pages (zentro://) and the main process.
 * - Only zentro:// pages in the top frame of a window we created can call in.
 * - Every method has a scope: "chrome" (toolbar/sidebar UI only) or "any" (any browser page).
 * - Every argument is validated here; pages never send file paths.
 */
const { ipcMain, dialog, nativeTheme, app } = require('electron');
const fs = require('fs');
const { SEARCH_ENGINES, resolveInput } = require('../core/urls');
const { PERMISSION_LABELS } = require('./permissions');
const { exportNetscape, importNetscape } = require('../core/bookmarks-io');
const { getArticle, openReader } = require('./reader');
const { shell } = require('electron');

const bad = (m = 'Invalid request.') => Object.assign(new Error(m), { expose: true });
const str = (v, max = 2048) => { if (typeof v !== 'string' || v.length > max) throw bad(); return v; };
const int = (v, min, max) => { if (!Number.isInteger(v) || v < min || v > max) throw bad(); return v; };
const bool = (v) => v === true;
const obj = (v) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(); return v; };
const uuid = (v) => { if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw bad(); return v; };

function registerIpc(z) {
  const H = new Map();
  const def = (name, scope, fn) => H.set(name, { scope, fn });
  const P = z.profile;
  const rangeStart = (r) => ({ hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[r] ? Date.now() - { hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[r] : null);

  // ---------------------------------------------------------------- toolbar / sidebar UI only
  def('tab:new', 'chrome', (a, i) => { i.window.addTab({ url: 'zentro://newtab/', openerId: i.window.activeId }); });
  def('tab:close', 'chrome', (a, i) => i.window.closeTab(int(a, 1, 1e9)));
  def('tab:activate', 'chrome', (a, i) => i.window.activate(int(a, 1, 1e9)));
  def('tab:duplicate', 'chrome', (a, i) => i.window.duplicate(int(a, 1, 1e9)));
  def('tab:pin', 'chrome', (a, i) => i.window.pin(int(a, 1, 1e9)));
  def('tab:mute', 'chrome', (a, i) => { const t = i.window.byId(int(a, 1, 1e9)); if (t) t.setMuted(!t.muted); });
  def('tab:menu', 'chrome', (a, i) => i.window.tabMenu(int(a, 1, 1e9)));
  def('tab:move', 'chrome', (a, i) => { obj(a); i.window.moveTab(int(a.id, 1, 1e9), int(a.index, 0, 1000)); });
  def('nav:go', 'chrome', (a, i) => i.window.goTyped(str(a, 2048)));
  def('nav:action', 'chrome', (a, i) => {
    const ok = new Set(['back', 'forward', 'reload', 'reload:hard', 'stop', 'home', 'zoom:in', 'zoom:out', 'zoom:reset', 'print', 'devtools', 'reader',
      'window:new', 'window:private', 'history', 'clear-data', 'fullscreen', 'tab:reopen', 'tab:new', 'ai:toggle']);
    if (!ok.has(a)) throw bad();
    i.window.runAction(a);
  });
  def('ui:extent', 'chrome', (a, i) => { i.window.setExtent(a === 'full' ? 'full' : int(a, 0, 500)); });
  def('find:start', 'chrome', (a, i) => { obj(a); i.window.findStart({ text: str(a.text, 200), forward: a.forward !== false, matchCase: bool(a.matchCase), next: bool(a.next) }); });
  def('find:stop', 'chrome', (a, i) => i.window.findStop());
  def('suggest', 'chrome', (a) => P.suggest(str(a, 200), 6));
  def('sidebar:toggle', 'chrome', (a, i) => i.window.openSidebarItem(str(a, 40)));
  def('permission:answer', 'chrome', (a, i) => { obj(a); i.window.answerPermission(str(a.id, 80), bool(a.allow), bool(a.remember)); });
  def('shield:toggle-site', 'chrome', (a, i) => { const t = i.window.active(); const s = t && z.shield.pageState(t); if (s && s.web) z.shield.toggleSite(s.host); });
  def('bookmark:state', 'chrome', (a, i) => {
    const t = i.window.active();
    const bm = t ? P.findBookmark(t.url) : null;
    return { bookmark: bm, title: t ? t.title : '', url: t ? t.url : '', web: !!t && /^https?:/i.test(t.url), folders: P.listBookmarks().folders };
  });
  def('bookmark:save', 'chrome', (a) => { obj(a); return P.addBookmark({ title: str(a.title, 300), url: str(a.url), folderId: a.folderId ? str(a.folderId, 80) : null }); });
  def('bookmark:remove-url', 'chrome', (a) => { const b = P.findBookmark(str(a)); if (b) P.removeBookmark(b.id); });
  def('collections:add-current', 'chrome', (a, i) => {
    obj(a);
    const t = i.window.active();
    if (!t || !/^https?:/i.test(t.url)) throw bad('Open a website first.');
    let cid = a.collectionId ? str(a.collectionId, 80) : null;
    if (!cid) cid = P.createCollection(str(a.newName || 'My collection', 80)).id;
    P.addToCollection(cid, { type: 'site', title: t.title || t.url, url: t.url });
    return true;
  });
  def('ui:state', 'chrome', (a, i) => i.window.state());

  // ---------------------------------------------------------------- any browser page
  def('nav:open', 'any', (a, i) => {
    obj(a);
    const r = resolveInput(str(a.text, 2048), P.settings.engine || P.settings.searchEngine);
    if (!r || r.url.startsWith('file:')) throw bad('That address can\u2019t be opened.');
    const w = i.window;
    if (i.role === 'panel' || a.newTab) w.addTab({ url: r.url, openerId: w.activeId });
    else if (i.tab) i.tab.navigate(r.url);
  });
  def('settings:get', 'any', () => ({
    settings: P.settings,
    dark: nativeTheme.shouldUseDarkColors,
    engines: Object.fromEntries(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name])),
    defaultDownloadDir: app.getPath('downloads'),
    version: app.getVersion(),
    team: require('../core/config').TEAM_NAME,
    chromium: process.versions.chrome,
    electron: process.versions.electron,
    wallpapers: z.wallpapers.list().map((w) => ({ id: w.id, video: w.ext === 'mp4' })),
    forceDarkRunning: z.forceDark,
    defaultBlocklist: require('../core/defaults').DEFAULT_BLOCKLIST,
  }));
  def('settings:set', 'any', (a) => P.updateSettings(obj(a)));
  def('settings:reset', 'any', () => P.resetSettings());
  def('settings:choose-download-dir', 'any', async (a, i) => {
    const r = await dialog.showOpenDialog(i.window.win, { title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { fs.mkdirSync(r.filePaths[0], { recursive: true }); fs.accessSync(r.filePaths[0], fs.constants.W_OK); } catch { throw bad('Zentro Browser can\u2019t write to that folder.'); }
    return P.updateSettings({ downloadDir: r.filePaths[0] });
  });
  def('wallpapers:list', 'any', () => z.wallpapers.list().map((w) => ({ id: w.id, video: w.ext === 'mp4' })));
  def('wallpapers:add', 'any', async (a, i) => {
    const r = await dialog.showOpenDialog(i.window.win, { title: 'Choose background images or videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images and videos (MP4)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'm4v'] }] });
    if (r.canceled || !r.filePaths.length) return [];
    const ids = [];
    for (const f of r.filePaths.slice(0, 12)) ids.push(z.wallpapers.addFile(f));
    P.updateSettings({ newtab: { background: 'custom', wallpaper: ids[ids.length - 1] } });
    return ids;
  });
  def('wallpapers:add-data', 'any', (a) => {
    obj(a);
    const d = a.data;
    if (!(d instanceof Uint8Array) && !(d instanceof ArrayBuffer)) throw bad();
    const id = z.wallpapers.addBuffer(Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d));
    P.updateSettings({ newtab: { background: 'custom', wallpaper: id } });
    return id;
  });
  def('wallpapers:remove', 'any', (a) => {
    const id = str(a, 20);
    z.wallpapers.remove(id);
    if (P.settings.newtab.wallpaper === id) P.updateSettings({ newtab: { background: 'ember', wallpaper: null } });
  });
  // ---------------------------------------------------------------- accounts, Premium, VPN, updates
  // scope "gate" = also callable from the sign-in and update screens (which are not browser windows)
  const A = z.account;
  const afterSignIn = async (st) => { z.broadcast('account-changed'); z.premium.refresh().catch(() => {}); return st; };
  def('account:state', 'gate', () => A.publicState());
  def('account:signup', 'gate', async (a) => { obj(a); return afterSignIn(await A.signUp(str(a.email, 254), str(a.password, 128))); });
  def('account:signin', 'gate', async (a) => { obj(a); return afterSignIn(await A.signIn(str(a.email, 254), str(a.password, 128))); });
  def('account:google', 'gate', async () => afterSignIn(await A.signInGoogle()));
  def('account:reset', 'gate', (a) => { obj(a); return A.resetPassword(str(a.email, 254)); });
  def('account:resend', 'gate', () => A.resendVerification());
  def('account:refresh', 'gate', async () => afterSignIn(await A.refreshProfile()));
  def('account:signout', 'gate', async () => { await z.vpn.disconnect().catch(() => {}); A.signOut(); await z.premium.refresh(); z.broadcast('account-changed'); return A.publicState(); });
  def('account:skip', 'gate', () => { A.skip(); z.finishGate(); });
  def('account:continue', 'gate', () => { if (A.signedIn()) z.finishGate(); });
  def('premium:state', 'gate', () => z.premium.publicState());
  def('premium:refresh', 'gate', () => z.premium.refresh());
  def('premium:buy', 'gate', () => z.premium.buy());
  def('vpn:state', 'gate', () => z.vpn.publicState());
  def('vpn:servers', 'gate', async () => (await z.vpn.listServers()).map((s) => ({ id: s.id, name: s.name, country: s.country })));
  def('vpn:connect', 'gate', (a) => z.vpn.connect(str(a, 40)));
  def('vpn:disconnect', 'gate', () => z.vpn.disconnect());
  def('update:info', 'gate', (a, i) => ({ ...(z.updater.info || { current: app.getVersion(), latest: '', url: '' }), runtime: i.role === 'gate-runtime' }));
  def('update:download', 'gate', () => z.updater.openPage());
  def('update:install', 'gate', (a, i) => z.updater.install((p) => { if (i.wc && !i.wc.isDestroyed()) i.wc.send('zentro:event', 'update-progress', p); }));
  def('update:later', 'gate', (a, i) => { if (i.role === 'gate-runtime' && z.updateShown && !z.updateShown.isDestroyed()) z.updateShown.close(); });
  def('app:quit', 'gate', () => z.quit());

  def('app:restart', 'any', () => { app.relaunch(); app.quit(); });

  def('newtab:data', 'any', () => ({
    recent: P.settings.newtab.showRecent ? P.recentSites(8) : [],
    stats: { blockedTotal: P.stats.blockedTotal, since: P.stats.since },
  }));

  def('bookmarks:list', 'any', () => P.listBookmarks());
  def('bookmarks:add', 'any', (a) => { obj(a); return P.addBookmark({ title: str(a.title, 300), url: str(a.url), folderId: a.folderId ? str(a.folderId, 80) : null }); });
  def('bookmarks:update', 'any', (a) => { obj(a); return P.updateBookmark(str(a.id, 80), { title: a.title === undefined ? undefined : str(a.title, 300), url: a.url === undefined ? undefined : str(a.url), folderId: a.folderId === undefined ? undefined : (a.folderId ? str(a.folderId, 80) : null) }); });
  def('bookmarks:remove', 'any', (a) => P.removeBookmark(str(a, 80)));
  def('folders:add', 'any', (a) => P.addFolder(str(a, 80)));
  def('folders:rename', 'any', (a) => { obj(a); P.renameFolder(str(a.id, 80), str(a.name, 80)); });
  def('folders:remove', 'any', (a) => P.removeFolder(str(a, 80)));
  def('bookmarks:import', 'any', async (a, i) => {
    const r = await dialog.showOpenDialog(i.window.win, { title: 'Import bookmarks', properties: ['openFile'], filters: [{ name: 'Bookmarks (HTML)', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (fs.statSync(r.filePaths[0]).size > 20 * 1024 * 1024) throw bad('That file is too large.');
    return P.importBookmarks(importNetscape(fs.readFileSync(r.filePaths[0], 'utf8')).bookmarks);
  });
  def('bookmarks:export', 'any', async (a, i) => {
    const r = await dialog.showSaveDialog(i.window.win, { title: 'Export bookmarks', defaultPath: 'zentro-bookmarks.html', filters: [{ name: 'Bookmarks (HTML)', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, exportNetscape(P.listBookmarks()), 'utf8');
    return true;
  });

  def('history:list', 'any', (a) => { obj(a); return P.listHistory({ query: str(a.query || '', 200), limit: int(a.limit || 200, 1, 500), offset: int(a.offset || 0, 0, 1e6) }); });
  def('history:remove', 'any', (a) => P.removeHistory(str(a)));
  def('history:clear', 'any', (a) => P.clearHistory(rangeStart(a)));

  def('downloads:list', 'any', () => z.downloads.list());
  def('downloads:pause', 'any', (a) => z.downloads.pause(uuid(a)));
  def('downloads:resume', 'any', (a) => z.downloads.resume(uuid(a)));
  def('downloads:cancel', 'any', (a) => z.downloads.cancel(uuid(a)));
  def('downloads:retry', 'any', (a) => z.downloads.retry(uuid(a)));
  def('downloads:remove', 'any', (a) => z.downloads.remove(uuid(a)));
  def('downloads:clear', 'any', () => z.downloads.clearFinished());
  def('downloads:reveal', 'any', (a) => z.downloads.reveal(uuid(a)));
  def('downloads:open', 'any', (a, i) => z.downloads.open(uuid(a), i.window.win));

  def('collections:list', 'any', () => P.listCollections());
  def('collections:create', 'any', (a) => P.createCollection(str(a, 80)));
  def('collections:rename', 'any', (a) => { obj(a); P.renameCollection(str(a.id, 80), str(a.name, 80)); });
  def('collections:delete', 'any', (a) => P.deleteCollection(str(a, 80)));
  def('collections:add', 'any', (a) => { obj(a); return P.addToCollection(str(a.id, 80), { type: a.type === 'note' ? 'note' : 'site', title: str(a.title || '', 200), url: a.url ? str(a.url) : undefined, text: a.text ? str(a.text, 5000) : undefined }); });
  def('collections:remove-item', 'any', (a) => { obj(a); P.removeFromCollection(str(a.id, 80), str(a.itemId, 80)); });

  // ---------------------------------------------------------------- AI assistant (floating panel) and profile picture
  def('ai:state', 'any', (a, inf) => (inf.window ? inf.window.ai.state() : null));
  def('ai:close', 'ai', (a, inf) => inf.window.ai.close());
  def('ai:provider', 'ai', (a, inf) => inf.window.ai.setProvider(str(a, 20)));
  def('ai:new', 'ai', (a, inf) => inf.window.ai.newChat());
  def('ai:reload', 'ai', (a, inf) => inf.window.ai.reload());
  def('ai:move', 'ai', (a, inf) => { obj(a); const n = (v) => Math.max(-3000, Math.min(3000, Number(v) || 0)); inf.window.ai.move(n(a.dx), n(a.dy)); });
  def('ai:extra', 'ai', (a, inf) => inf.window.ai.setExtra(int(a, 0, 300)));
  def('ai:size', 'ai', (a, inf) => inf.window.ai.resize(str(a, 2)));
  def('ai:share', 'ai', (a, inf) => inf.window.ai.share(str(a, 20)));
  def('avatar:choose', 'any', async (a, inf) => {
    const r = await dialog.showOpenDialog(inf.window.win, { title: 'Choose a profile picture', properties: ['openFile'], filters: [{ name: 'Pictures (GIFs animate)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    z.avatar.setFromFile(r.filePaths[0]);
    return P.updateSettings({ avatar: { image: true, rev: P.settings.avatar.rev + 1 } }).avatar;
  });
  def('homelogo:choose', 'any', async (a, inf) => {
    const r = await dialog.showOpenDialog(inf.window.win, { title: 'Choose your Zentro logo', properties: ['openFile'], filters: [{ name: 'Pictures (GIFs animate)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    z.homeLogo.setFromFile(r.filePaths[0]);
    return P.updateSettings({ homeLogo: { image: true, rev: P.settings.homeLogo.rev + 1 } }).homeLogo;
  });
  def('homelogo:remove', 'any', () => { z.homeLogo.clear(); return P.updateSettings({ homeLogo: { image: false, rev: P.settings.homeLogo.rev + 1 } }).homeLogo; });
  def('avatar:remove', 'any', () => { z.avatar.clear(); return P.updateSettings({ avatar: { image: false, rev: P.settings.avatar.rev + 1 } }).avatar; });

  def('ai:login', 'ai', (a, inf) => inf.window.ai.loginWithGoogle());
  def('ai:fix', 'ai', (a, inf) => inf.window.ai.fixLogin());

  // ---------------------------------------------------------------- School Mode and chat
  def('school:get', 'any', () => z.school.get());
  def('school:set', 'any', (a) => z.school.set(obj(a)));
  def('chat:rooms', 'any', () => z.chat.rooms());
  def('chat:list', 'any', (a) => { obj(a); return z.chat.list(str(a.room, 20), int(a.after, 0, 1e9), str(a.epoch || '', 20)); });
  def('chat:send', 'any', (a) => { obj(a); return z.chat.send(str(a.room, 20), str(a.text, 400)); });

  def('extensions:list', 'any', () => z.extensions.list());
  def('extensions:add', 'any', (a, i) => z.extensions.chooseAndAdd(i.window.win));
  def('extensions:store-add', 'any', (a, i) => z.extensions.installFromStore(i.window.win, str(a, 500)));
  def('extensions:enable', 'any', async (a) => { obj(a); await z.extensions.setEnabled(str(a.path, 400), bool(a.enabled)); });
  def('extensions:remove', 'any', (a) => z.extensions.remove(str(a, 400)));

  def('shield:info', 'any', () => ({ listSize: z.shield.list.size, blockedTotal: P.stats.blockedTotal, since: P.stats.since, updated: P.filters }));
  def('shield:update-lists', 'any', () => z.shield.updateLists());

  def('permissions:list', 'any', () => {
    const out = [];
    for (const [origin, perms] of Object.entries(P.getSitePermissions())) for (const [permission, decision] of Object.entries(perms)) out.push({ origin, permission, decision, label: PERMISSION_LABELS[permission] || permission });
    return out;
  });
  def('permissions:revoke', 'any', (a) => { obj(a); P.setSitePermission(str(a.origin, 300), str(a.permission, 60), null); });

  def('data:clear', 'any', async (a, i) => {
    obj(a); obj(a.items);
    const since = rangeStart(a.range);
    const ses = z.regularSession;
    if (a.items.history) P.clearHistory(since);
    if (a.items.downloads) z.downloads.clearFinished();
    if (a.items.cache) await ses.clearCache();
    if (a.items.cookies) await ses.clearStorageData({ storages: ['cookies'] });
    if (a.items.siteData) await ses.clearStorageData({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql'] });
    return true;
  });

  def('reader:get', 'any', (a) => { const art = getArticle(str(a, 80)); if (!art) throw bad('This article is no longer available. Open reading mode again.'); return art; });

  ipcMain.handle('zentro:call', async (event, method, arg) => {
    try {
      const f = event.senderFrame;
      const info = z.registry.get(event.sender.id);
      if (!info || !f || f !== event.sender.mainFrame || !String(f.url).startsWith('zentro://')) throw bad('Request blocked.');
      const h = H.get(String(method));
      if (!h) throw bad('Unknown request.');
      if (h.scope === 'chrome' && info.role !== 'top' && info.role !== 'side') throw bad('Request blocked.');
      if (h.scope === 'ai' && info.role !== 'ai') throw bad('Request blocked.');
      if ((info.role === 'gate' || info.role === 'gate-runtime') && h.scope !== 'gate') throw bad('Request blocked.');
      return { ok: true, data: await h.fn(arg, info, event) };
    } catch (err) {
      if (!(err && err.expose)) console.error('[ipc]', method, err);
      return { ok: false, error: err && err.expose ? err.message : 'Something went wrong. Please try again.' };
    }
  });
}

module.exports = { registerIpc };
