'use strict';
/**
 * Everything the browser remembers: settings, bookmarks, history, collections, session, downloads list,
 * Shield statistics, site permissions and extensions. One JSON file, atomic writes, no Electron.
 */
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { JsonStore } = require('./store');
const { DEFAULT_SETTINGS, sanitizeSettings, clone } = require('./defaults');

class ProfileError extends Error {
  constructor(m) { super(m); this.expose = true; }
}

const HISTORY_CAP = 5000;
const id = () => crypto.randomUUID();
const now = () => Date.now();

function cleanHttp(url, label = 'Link') {
  try {
    const u = new URL(String(url));
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && String(url).length <= 2048) return u.href;
  } catch { /* fall through */ }
  throw new ProfileError(`${label} must be an http or https link.`);
}
function cleanText(v, max, label, { allowEmpty = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if ((!s && !allowEmpty) || s.length > max) throw new ProfileError(`${label} is empty or too long.`);
  return s;
}

class Profile extends EventEmitter {
  constructor(filePath) {
    super();
    this.store = new JsonStore(filePath);
    this.store.load();
    let settings;
    try { settings = sanitizeSettings(this.store.get('settings', {}), clone(DEFAULT_SETTINGS)); } catch { settings = clone(DEFAULT_SETTINGS); }
    this.settings = settings;
    const b = this.store.get('bookmarks', {});
    this.bookmarks = { folders: Array.isArray(b.folders) ? b.folders : [], bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : [] };
    const h = this.store.get('history', []);
    this.history = Array.isArray(h) ? h.filter((e) => e && typeof e.url === 'string') : [];
    this._hIndex = new Map(this.history.map((e) => [e.url, e]));
    this.collections = this.store.get('collections', []);
    if (!Array.isArray(this.collections)) this.collections = [];
    this.sessionData = this.store.get('session', { windows: [] });
    this.downloads = this.store.get('downloads', []);
    if (!Array.isArray(this.downloads)) this.downloads = [];
    this.stats = this.store.get('stats', { blockedTotal: 0, since: now() });
    this.extensions = this.store.get('extensions', []);
    if (!Array.isArray(this.extensions)) this.extensions = [];
    this.sitePermissions = this.store.get('sitePermissions', {});
    this.bounds = this.store.get('bounds', null);
    this.filters = this.store.get('filters', { at: null, count: 0 });
    this._timer = null;
  }

  // ------------------------------------------------------------ persistence
  _dirty(topic) {
    if (topic) this.emit('changed', topic);
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 800);
    if (this._timer.unref) this._timer.unref();
  }
  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    for (const k of ['settings', 'bookmarks', 'history', 'collections', 'downloads', 'stats', 'extensions', 'sitePermissions', 'bounds', 'filters']) {
      this.store.set(k, k === 'session' ? this.sessionData : this[k]);
    }
    this.store.set('session', this.sessionData);
    this.store.flush();
  }

  // ------------------------------------------------------------ settings
  updateSettings(patch) { this.settings = sanitizeSettings(patch, this.settings); this._dirty('settings'); return this.settings; }
  resetSettings() { this.settings = clone(DEFAULT_SETTINGS); this._dirty('settings'); return this.settings; }

  // ------------------------------------------------------------ bookmarks
  listBookmarks() { return clone(this.bookmarks); }
  findBookmark(url) { return this.bookmarks.bookmarks.find((b) => b.url === url) || null; }
  addBookmark({ title, url, folderId = null }) {
    const u = cleanHttp(url);
    if (folderId && !this.bookmarks.folders.some((f) => f.id === folderId)) folderId = null;
    const existing = this.findBookmark(u);
    if (existing) return this.updateBookmark(existing.id, { title, folderId });
    if (this.bookmarks.bookmarks.length >= 20000) throw new ProfileError('Too many bookmarks.');
    const b = { id: id(), title: cleanText(title || u, 300, 'Title'), url: u, folderId, addedAt: now() };
    this.bookmarks.bookmarks.push(b);
    this._dirty('bookmarks');
    return b;
  }
  updateBookmark(bid, patch) {
    const b = this.bookmarks.bookmarks.find((x) => x.id === bid);
    if (!b) throw new ProfileError('Bookmark not found.');
    if (patch.title !== undefined) b.title = cleanText(patch.title, 300, 'Title');
    if (patch.url !== undefined) b.url = cleanHttp(patch.url);
    if (patch.folderId !== undefined) b.folderId = patch.folderId && this.bookmarks.folders.some((f) => f.id === patch.folderId) ? patch.folderId : null;
    this._dirty('bookmarks');
    return b;
  }
  removeBookmark(bid) {
    const n = this.bookmarks.bookmarks.length;
    this.bookmarks.bookmarks = this.bookmarks.bookmarks.filter((b) => b.id !== bid);
    if (this.bookmarks.bookmarks.length !== n) this._dirty('bookmarks');
  }
  addFolder(name) {
    const f = { id: id(), name: cleanText(name, 80, 'Folder name') };
    if (this.bookmarks.folders.length >= 500) throw new ProfileError('Too many folders.');
    this.bookmarks.folders.push(f);
    this._dirty('bookmarks');
    return f;
  }
  renameFolder(fid, name) {
    const f = this.bookmarks.folders.find((x) => x.id === fid);
    if (!f) throw new ProfileError('Folder not found.');
    f.name = cleanText(name, 80, 'Folder name');
    this._dirty('bookmarks');
  }
  removeFolder(fid) {
    this.bookmarks.folders = this.bookmarks.folders.filter((f) => f.id !== fid);
    for (const b of this.bookmarks.bookmarks) if (b.folderId === fid) b.folderId = null;
    this._dirty('bookmarks');
  }
  importBookmarks(items) {
    let added = 0;
    for (const it of items.slice(0, 20000)) {
      let folderId = null;
      if (it.folder) {
        let f = this.bookmarks.folders.find((x) => x.name === it.folder);
        if (!f && this.bookmarks.folders.length < 500) { f = { id: id(), name: it.folder.slice(0, 80) }; this.bookmarks.folders.push(f); }
        folderId = f ? f.id : null;
      }
      let url;
      try { url = cleanHttp(it.url); } catch { continue; }
      if (this.bookmarks.bookmarks.some((b) => b.url === url && b.folderId === folderId)) continue;
      if (this.bookmarks.bookmarks.length >= 20000) break;
      this.bookmarks.bookmarks.push({ id: id(), title: String(it.title || url).slice(0, 300), url, folderId, addedAt: now() });
      added++;
    }
    this._dirty('bookmarks');
    return added;
  }

  // ------------------------------------------------------------ history
  addVisit(url, title) {
    let u;
    try { u = cleanHttp(url); } catch { return; }
    let e = this._hIndex.get(u);
    if (e) { e.visits++; e.lastVisit = now(); if (title) e.title = String(title).slice(0, 300); }
    else {
      e = { url: u, title: String(title || '').slice(0, 300), lastVisit: now(), visits: 1 };
      this.history.push(e);
      this._hIndex.set(u, e);
      if (this.history.length > HISTORY_CAP + 100) {
        this.history.sort((a, b) => b.lastVisit - a.lastVisit);
        for (const old of this.history.splice(HISTORY_CAP)) this._hIndex.delete(old.url);
      }
    }
    this._dirty('history');
  }
  setTitle(url, title) {
    const e = this._hIndex.get(url);
    if (e && title && e.title !== title) { e.title = String(title).slice(0, 300); this._dirty(); }
  }
  listHistory({ query = '', limit = 200, offset = 0 } = {}) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const all = this.history.filter((e) => terms.every((t) => e.url.toLowerCase().includes(t) || (e.title || '').toLowerCase().includes(t)));
    all.sort((a, b) => b.lastVisit - a.lastVisit);
    return { total: all.length, items: all.slice(offset, offset + Math.min(500, limit)) };
  }
  removeHistory(url) {
    if (this._hIndex.delete(url)) { this.history = this.history.filter((e) => e.url !== url); this._dirty('history'); }
  }
  clearHistory(sinceMs = null) {
    this.history = sinceMs ? this.history.filter((e) => e.lastVisit < sinceMs) : [];
    this._hIndex = new Map(this.history.map((e) => [e.url, e]));
    this._dirty('history');
  }
  recentSites(limit = 8) {
    const seen = new Set(); const out = [];
    for (const e of [...this.history].sort((a, b) => b.lastVisit - a.lastVisit)) {
      let host; try { host = new URL(e.url).hostname; } catch { continue; }
      if (seen.has(host)) continue;
      seen.add(host);
      out.push({ title: e.title || host, url: e.url, host });
      if (out.length >= limit) break;
    }
    return out;
  }

  suggest(text, limit = 6) {
    const terms = String(text).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hit = (s) => terms.every((t) => s.includes(t));
    const map = new Map();
    for (const b of this.bookmarks.bookmarks) {
      if (hit(`${b.title} ${b.url}`.toLowerCase())) map.set(b.url, { type: 'bookmark', title: b.title, url: b.url, score: 1000 });
    }
    for (const e of this.history) {
      if (!hit(`${e.title || ''} ${e.url}`.toLowerCase())) continue;
      const score = e.visits * 10 + e.lastVisit / 1e11 + (new URL(e.url).hostname.startsWith(terms[0]) ? 50 : 0);
      const prev = map.get(e.url);
      if (!prev) map.set(e.url, { type: 'history', title: e.title || e.url, url: e.url, score });
    }
    return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ type, title, url }) => ({ type, title, url }));
  }

  // ------------------------------------------------------------ collections
  listCollections() { return clone(this.collections); }
  createCollection(name) {
    if (this.collections.length >= 100) throw new ProfileError('Too many collections.');
    const c = { id: id(), name: cleanText(name, 80, 'Collection name'), createdAt: now(), items: [] };
    this.collections.push(c);
    this._dirty('collections');
    return c;
  }
  renameCollection(cid, name) { this._col(cid).name = cleanText(name, 80, 'Collection name'); this._dirty('collections'); }
  deleteCollection(cid) { this.collections = this.collections.filter((c) => c.id !== cid); this._dirty('collections'); }
  addToCollection(cid, item) {
    const c = this._col(cid);
    if (c.items.length >= 500) throw new ProfileError('This collection is full.');
    let entry;
    if (item.type === 'note') entry = { id: id(), type: 'note', title: cleanText(item.title || 'Note', 200, 'Title'), text: cleanText(item.text, 5000, 'Note') };
    else entry = { id: id(), type: 'site', title: cleanText(item.title || item.url, 200, 'Title'), url: cleanHttp(item.url) };
    entry.addedAt = now();
    c.items.push(entry);
    this._dirty('collections');
    return entry;
  }
  removeFromCollection(cid, itemId) { const c = this._col(cid); c.items = c.items.filter((i) => i.id !== itemId); this._dirty('collections'); }
  _col(cid) {
    const c = this.collections.find((x) => x.id === cid);
    if (!c) throw new ProfileError('Collection not found.');
    return c;
  }

  // ------------------------------------------------------------ session, downloads, stats, permissions, extensions, bounds
  getSession() { return this.sessionData; }
  setSession(windows) {
    const clean = [];
    for (const w of Array.isArray(windows) ? windows.slice(0, 10) : []) {
      const tabs = [];
      for (const t of (w.tabs || []).slice(0, 200)) {
        if (typeof t.url !== 'string' || !/^(https?|zentro):/i.test(t.url) || t.url.length > 2048) continue;
        tabs.push({ url: t.url, title: String(t.title || '').slice(0, 300), pinned: !!t.pinned, favicon: /^https?:/i.test(t.favicon || '') ? String(t.favicon).slice(0, 2048) : null });
      }
      if (tabs.length) clean.push({ tabs, active: Math.max(0, Math.min(tabs.length - 1, Number(w.active) || 0)) });
    }
    this.sessionData = { windows: clean };
    this._dirty();
  }
  setDownloads(list) { this.downloads = list.slice(-500); this._dirty(); }
  addBlocked(n) { this.stats.blockedTotal += n; this._dirty('stats'); }
  getSitePermissions() { return clone(this.sitePermissions); }
  setSitePermission(origin, perm, decision) {
    if (decision === null) {
      if (this.sitePermissions[origin]) { delete this.sitePermissions[origin][perm]; if (!Object.keys(this.sitePermissions[origin]).length) delete this.sitePermissions[origin]; }
    } else {
      if (decision !== 'allow' && decision !== 'deny') throw new ProfileError('Invalid permission.');
      (this.sitePermissions[origin] = this.sitePermissions[origin] || {})[perm] = decision;
    }
    this._dirty('permissions');
  }
  setExtensions(list) { this.extensions = list.slice(0, 50); this._dirty('extensions'); }
  setBounds(b) { this.bounds = b; this._dirty(); }
  setFilters(f) { this.filters = f; this._dirty('stats'); }
}

module.exports = { Profile, ProfileError };
