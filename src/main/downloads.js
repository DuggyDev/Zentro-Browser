'use strict';
/** Browser downloads: progress, speed, pause/resume, cancel, retry. Never opens a file by itself. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, shell, Notification } = require('electron');
const { sanitizeFileName, uniquePathSync, isDangerousFile } = require('../core/fsutil');

const bad = (m) => Object.assign(new Error(m), { expose: true });

class Downloads {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = new Map();
    this.live = new Map();
    this.sessions = new Map();
    for (const d of ctx.profile.downloads) {
      if (!d || typeof d.id !== 'string') continue;
      const rec = { ...d, speed: 0 };
      if (rec.state === 'progressing' || rec.state === 'paused') { rec.state = 'failed'; rec.error = 'Interrupted when Zentro Browser closed.'; }
      this.items.set(rec.id, rec);
    }
    this.timer = null;
  }

  dir() {
    return this.ctx.profile.settings.downloadDir || app.getPath('downloads');
  }

  attach(ses, isPrivate) {
    ses.on('will-download', (_event, item) => this._start(ses, isPrivate, item));
  }

  _start(ses, isPrivate, item) {
    const url = item.getURL();
    if (!/^(https?|blob|data):/i.test(url)) { item.cancel(); return; }
    let savePath;
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      savePath = uniquePathSync(this.dir(), sanitizeFileName(item.getFilename()));
    } catch { item.cancel(); return; }
    item.setSavePath(savePath);
    const rec = {
      id: crypto.randomUUID(), url: /^https?:/i.test(url) ? url : '', fileName: path.basename(savePath), savePath,
      totalBytes: item.getTotalBytes(), receivedBytes: 0, state: 'progressing', startedAt: Date.now(), endedAt: null,
      speed: 0, error: null, private: isPrivate,
    };
    this.items.set(rec.id, rec);
    this.live.set(rec.id, item);
    this.sessions.set(rec.id, ses);
    let last = { t: Date.now(), b: 0 };
    item.on('updated', (_e, state) => {
      const t = Date.now();
      rec.receivedBytes = item.getReceivedBytes();
      rec.totalBytes = item.getTotalBytes();
      if (t - last.t >= 500) { rec.speed = (rec.receivedBytes - last.b) / ((t - last.t) / 1000); last = { t, b: rec.receivedBytes }; }
      if (state === 'interrupted') {
        rec.state = item.canResume() ? 'paused' : 'failed';
        if (rec.state === 'failed') rec.error = 'The connection was interrupted.';
      } else rec.state = item.isPaused() ? 'paused' : 'progressing';
      this._changed(false);
    });
    item.once('done', (_e, state) => {
      this.live.delete(rec.id);
      rec.endedAt = Date.now();
      rec.speed = 0;
      rec.receivedBytes = item.getReceivedBytes();
      rec.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'canceled' : 'failed';
      if (rec.state === 'failed') rec.error = 'The download was interrupted.';
      this._changed(true);
      if (state === 'completed' && this.ctx.profile.settings.notifications && Notification.isSupported()) {
        const n = new Notification({ title: 'Download complete', body: rec.fileName });
        n.on('click', () => shell.showItemInFolder(rec.savePath));
        n.show();
      }
    });
    this.ctx.broadcast('download-started', this.pub(rec));
    this._changed(true);
  }

  pub(r) {
    return {
      id: r.id, url: r.url, fileName: r.fileName, dir: path.dirname(r.savePath), totalBytes: r.totalBytes, receivedBytes: r.receivedBytes,
      state: r.state, startedAt: r.startedAt, endedAt: r.endedAt, speed: r.speed, error: r.error, private: !!r.private,
      dangerous: isDangerousFile(r.fileName), missing: r.state === 'completed' && !fs.existsSync(r.savePath),
      canRetry: !!r.url && (r.state === 'failed' || r.state === 'canceled'), canPause: this.live.has(r.id),
    };
  }
  list() { return [...this.items.values()].sort((a, b) => b.startedAt - a.startedAt).map((r) => this.pub(r)); }
  summary() {
    let active = 0; let rec = 0; let tot = 0;
    for (const r of this.items.values()) if (r.state === 'progressing') { active++; rec += r.receivedBytes; tot += r.totalBytes; }
    return { active, fraction: tot > 0 ? rec / tot : null };
  }

  _changed(now) {
    const persist = [...this.items.values()].filter((r) => !r.private).map(({ speed, ...r }) => r);
    this.ctx.profile.setDownloads(persist);
    if (now) { clearTimeout(this.timer); this.timer = null; this.ctx.broadcast('downloads-changed'); this.ctx.pushAllStates(); return; }
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.ctx.broadcast('downloads-changed'); this.ctx.pushAllStates(); }, 300);
  }

  _get(id) { const r = this.items.get(id); if (!r) throw bad('That download no longer exists.'); return r; }
  pause(id) { const i = this.live.get(id); if (!i) throw bad('This download can\u2019t be paused.'); i.pause(); }
  resume(id) {
    const i = this.live.get(id);
    if (i && i.canResume()) { i.resume(); return; }
    this.retry(id);
  }
  cancel(id) { const i = this.live.get(id); if (i) i.cancel(); }
  retry(id) {
    const r = this._get(id);
    if (!r.url) throw bad('This download can\u2019t be repeated. Download the file again from the website.');
    const ses = this.sessions.get(id) || this.ctx.regularSession;
    this.items.delete(id);
    this._changed(true);
    ses.downloadURL(r.url);
  }
  remove(id) {
    const r = this._get(id);
    const i = this.live.get(id);
    if (i) i.cancel();
    this.items.delete(id);
    this._changed(true);
    return r.fileName;
  }
  clearFinished() {
    for (const [id, r] of [...this.items]) if (r.state !== 'progressing' && r.state !== 'paused') this.items.delete(id);
    this._changed(true);
  }
  reveal(id) {
    const r = this._get(id);
    if (fs.existsSync(r.savePath)) shell.showItemInFolder(r.savePath); else shell.openPath(path.dirname(r.savePath));
  }
  async open(id, win) {
    const r = this._get(id);
    if (r.state !== 'completed') throw bad('This download isn\u2019t finished yet.');
    if (!fs.existsSync(r.savePath)) throw bad('That file has been moved or deleted.');
    if (isDangerousFile(r.fileName)) {
      let host = ''; try { host = new URL(r.url).hostname; } catch { /* unknown */ }
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Cancel', 'Show in folder', 'Open anyway'], defaultId: 0, cancelId: 0, noLink: true,
        title: 'Open this program?', message: `\u201C${r.fileName}\u201D can run code on your computer.`,
        detail: `It was downloaded${host ? ' from ' + host : ''}. Zentro Browser never runs downloads on its own. Only open it if you trust the source.`,
      });
      if (response === 0) return;
      if (response === 1) { shell.showItemInFolder(r.savePath); return; }
    }
    const err = await shell.openPath(r.savePath);
    if (err) throw bad('Windows couldn\u2019t open this file. Try \u201CShow in folder\u201D.');
  }
}

module.exports = { Downloads };
