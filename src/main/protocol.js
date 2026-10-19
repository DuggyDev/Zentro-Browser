'use strict';
/** zentro:// - serves the browser's own pages from the pages/ folder. Websites cannot reach these. */
const { net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..', 'pages');
const HOST_DIR = {
  ui: 'ui', newtab: 'newtab', settings: 'manage', history: 'manage', bookmarks: 'manage', downloads: 'manage',
  collections: 'manage', extensions: 'manage', account: 'manage', school: 'manage', chat: 'manage', login: 'login', update: 'update', reader: 'reader', error: 'error', assets: 'shared',
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'zentro', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function handleSession(ses, svc) {
  ses.protocol.handle('zentro', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.hostname === 'wallpaper' || u.hostname === 'favicon' || u.hostname === 'avatar' || u.hostname === 'homelogo') {
        const key = decodeURIComponent(u.pathname.slice(1));
        const file = u.hostname === 'wallpaper' ? svc.wallpaperFile(key) : u.hostname === 'avatar' ? svc.avatar.file() : u.hostname === 'homelogo' ? svc.homeLogo.file() : await svc.faviconFile(key);
        return file ? await net.fetch(pathToFileURL(file).toString()) : new Response('', { status: 404 });
      }
      const dir = HOST_DIR[u.hostname];
      if (!dir) return new Response('Not found', { status: 404 });
      let rel = decodeURIComponent(u.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const base = path.join(ROOT, dir);
      const full = path.resolve(base, '.' + rel);
      const back = path.relative(base, full);
      if (back.startsWith('..') || path.isAbsolute(back)) return new Response('Forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(full).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerScheme, handleSession };
