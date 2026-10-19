'use strict';
/**
 * Extensions use Electron's built-in (partial) Chromium extension support. Only UNPACKED extensions that you
 * choose yourself, or install from the Chrome Web Store, are loaded. Toolbar popups are not available and only part
 * of Chrome's extension APIs exist, so not every extension works.
 */
const fs = require('fs');
const path = require('path');
const { dialog, app } = require('electron');
const { extensionIdFrom, crxUrl, crxToZip, readZip, safeJoin } = require('../core/crx');

const bad = (m) => Object.assign(new Error(m), { expose: true });

class Extensions {
  constructor(ctx) { this.ctx = ctx; }

  get ses() { return this.ctx.regularSession; }
  get root() { return path.join(this.ctx.userData, 'extensions'); }

  async init() {
    for (const e of this.ctx.profile.extensions) if (e.enabled) await this._load(e);
    this.ctx.profile.setExtensions(this.ctx.profile.extensions);
  }

  async _load(e) {
    try {
      const x = await this.ses.extensions.loadExtension(e.path, { allowFileAccess: false });
      e.id = x.id; e.name = x.name || e.name; e.version = x.version || e.version; e.error = null;
    } catch (err) {
      e.error = String(err && err.message ? err.message : err).slice(0, 200);
    }
  }

  list() { return this.ctx.profile.extensions.map((e) => ({ ...e })); }

  async chooseAndAdd(win) {
    const r = await dialog.showOpenDialog(win, { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return this.add(r.filePaths[0]);
  }

  async add(dir, extra = {}) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { throw bad('That folder has no valid manifest.json.'); }
    if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw bad('This does not look like a browser extension (manifest version 2 or 3 is required).');
    }
    const list = this.ctx.profile.extensions;
    if (list.some((e) => e.path === dir)) throw bad('That extension is already added.');
    const entry = {
      ...extra, path: dir, enabled: true, id: null, name: manifest.name.slice(0, 80), version: manifest.version.slice(0, 30), error: null,
      permissions: [...(manifest.permissions || []), ...(manifest.host_permissions || [])].filter((p) => typeof p === 'string').slice(0, 30),
    };
    await this._load(entry);
    list.push(entry);
    this.ctx.profile.setExtensions(list);
    return { ...entry };
  }

  async setEnabled(p, enabled) {
    const e = this.ctx.profile.extensions.find((x) => x.path === p);
    if (!e) throw bad('Extension not found.');
    if (enabled) { e.enabled = true; await this._load(e); } else {
      e.enabled = false;
      if (e.id) { try { await this.ses.extensions.removeExtension(e.id); } catch { /* already gone */ } }
      e.id = null; e.error = null;
    }
    this.ctx.profile.setExtensions(this.ctx.profile.extensions);
  }

  async remove(p) {
    await this.setEnabled(p, false).catch(() => {});
    this.ctx.profile.setExtensions(this.ctx.profile.extensions.filter((x) => x.path !== p));
    const full = path.resolve(p);
    if (full.startsWith(this.root + path.sep)) fs.rmSync(full, { recursive: true, force: true }); // only folders Zentro itself created
  }

  /** Installs from a Chrome Web Store link or id: download, unpack, ask the person, load. */
  async installFromStore(win, input) {
    const id = extensionIdFrom(input);
    if (!id) throw bad('Paste a Chrome Web Store link (chromewebstore.google.com/detail/...) or the 32-letter extension id.');
    if (this.ctx.profile.extensions.some((e) => e.storeId === id)) throw bad('That extension is already installed.');
    let buf;
    try {
      const res = await fetch(crxUrl(id, process.versions.chrome), { signal: AbortSignal.timeout(60000), redirect: 'follow' });
      const host = new URL(res.url).hostname;
      if (!res.ok || !(host === 'clients2.google.com' || host.endsWith('.googleusercontent.com') || host.endsWith('.google.com'))) throw new Error('bad answer');
      if (Number(res.headers.get('content-length') || 0) > 100 * 1024 * 1024) throw new Error('too big');
      buf = Buffer.from(await res.arrayBuffer());
    } catch { throw bad('Could not download that extension. Check the link and your connection.'); }
    let files;
    try { files = readZip(crxToZip(buf)); } catch (e) { throw bad(e.message); }
    const mf = files.find((f) => f.name === 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(mf.data.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw bad('The extension has no valid manifest.json.'); }
    if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string') throw bad('This does not look like a browser extension.');
    const perms = [...(manifest.permissions || []), ...(manifest.host_permissions || [])].filter((x) => typeof x === 'string').slice(0, 12);
    const name = /^__MSG_/.test(manifest.name) ? 'This extension' : manifest.name.slice(0, 80);
    const ask = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Install', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: 'Install extension',
      message: `Install ${name}?`,
      detail: `It can read and change the pages you visit${perms.length ? `.\n\nRequested access: ${perms.join(', ')}` : '.'}\n\nOnly install extensions you trust. Not every Chrome extension works in Zentro.`,
    });
    if (ask.response !== 0) return null;
    const dir = path.join(this.root, id);
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      for (const f of files) {
        if (f.name.startsWith('_metadata/')) continue; // Web Store signature data, not needed
        const dest = safeJoin(dir, f.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.data);
      }
      return await this.add(dir, { storeId: id });
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e && e.expose ? e : bad('Could not install the extension.');
    }
  }
}

module.exports = { Extensions };
