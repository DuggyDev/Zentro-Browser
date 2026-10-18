'use strict';
/**
 * "You need to update" check and one-click update.
 *  - check(): asks GitHub for the newest release of the Zentro repo. Newer than this app = the update screen opens
 *    (at start-up, and every 15 minutes while the browser stays open). No internet = nobody is locked out.
 *  - install(): downloads Zentro-Setup.exe from that release, closes Zentro, runs the installer silently and starts
 *    the new version. If anything looks wrong it falls back to opening the release page.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, net, shell } = require('electron');
const cfg = require('../core/config');
const { isOutdated, isRepoConfigured, readRelease } = require('../core/version');
const { fetchJson } = require('./http');

const fail = (m) => Object.assign(new Error(m), { expose: true });
const MIN_BYTES = 1024 * 1024;

class Updater {
  constructor(z) { this.z = z; this.info = null; this.installing = false; }

  async check() {
    const repo = cfg.UPDATE_REPO;
    if (!isRepoConfigured(repo)) return { required: false, configured: false };
    try {
      const r = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ZentroBrowser-UpdateCheck' }, timeout: 6000,
      });
      const rel = r.ok ? readRelease(r.json, repo) : null;
      if (!rel) return { required: false, configured: true };
      const current = app.getVersion();
      if (isOutdated(current, rel.version)) { this.info = { current, latest: rel.version, name: rel.name, url: rel.url }; return { required: true, configured: true }; }
    } catch { /* offline or rate limited: let the person in */ }
    return { required: false, configured: true };
  }

  /** Opens the release page in the normal web browser (the manual way). */
  async openPage() {
    const u = this.info && this.info.url;
    if (u && /^https:\/\/github\.com\//.test(u)) await shell.openExternal(u);
  }

  async install(onProgress) {
    const info = this.info;
    if (!info || !info.url) throw fail('There is no update to install.');
    if (this.installing) return false;
    let u;
    try { u = new URL(info.url); } catch { throw fail('The update link is not valid.'); }
    const repo = cfg.UPDATE_REPO;
    if (process.platform !== 'win32' || u.protocol !== 'https:' || u.hostname !== 'github.com' || !u.pathname.startsWith(`/${repo}/`) || !/\.exe$/i.test(u.pathname)) {
      await this.openPage();                 // no direct installer link: send the person to the release page
      return false;
    }
    this.installing = true;
    const file = path.join(os.tmpdir(), `Zentro-Setup-${String(info.latest).replace(/[^0-9A-Za-z.-]/g, '')}.exe`);
    try {
      const res = await net.fetch(u.href, { redirect: 'follow', headers: { 'User-Agent': 'ZentroBrowser-Updater' } });
      if (!res.ok || !res.body) throw fail('The download did not start. Try again, or use the download page.');
      const total = Number(res.headers.get('content-length')) || 0;
      const out = fs.createWriteStream(file);
      let received = 0; let last = 0; let head = Buffer.alloc(0);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        if (head.length < 2) head = Buffer.concat([head, buf]).subarray(0, 2);
        received += buf.length;
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        if (onProgress && Date.now() - last > 120) { last = Date.now(); onProgress({ received, total }); }
      }
      await new Promise((resolve, reject) => { out.end((e) => (e ? reject(e) : resolve())); });
      if (received < MIN_BYTES || head.toString('latin1') !== 'MZ') throw fail('The downloaded file does not look like the installer. Use the download page instead.');
      if (onProgress) onProgress({ received, total: total || received, done: true });
      // Close Zentro first (files in use), then let the installer run silently and start the new version.
      const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 400);
      return true;
    } catch (err) {
      this.installing = false;
      try { fs.unlinkSync(file); } catch { /* not there */ }
      throw err.expose ? err : fail('The update could not be downloaded. Check your connection, or use the download page.');
    }
  }
}

module.exports = { Updater };
