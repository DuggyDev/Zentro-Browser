'use strict';
/** Website permissions are asked explicitly. Nothing is granted silently except harmless ones. */
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ASK = {
  geolocation: 'know your location',
  media: 'use your camera and microphone',
  notifications: 'show notifications',
  midiSysex: 'use your MIDI devices',
  'clipboard-read': 'see text and images you copied',
  'display-capture': 'share your screen',
  'idle-detection': 'know when you are idle',
};

class Permissions {
  constructor(ctx) { this.ctx = ctx; }

  _saved(origin, perm, isPrivate, memory) {
    if (isPrivate) return memory.get(`${origin}|${perm}`) || null;
    const p = this.ctx.profile.sitePermissions[origin];
    return (p && p[perm]) || null;
  }

  attach(ses, isPrivate) {
    const memory = new Map();
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      if (AUTO_ALLOW.has(permission)) return true;
      return this._saved(origin, permission, isPrivate, memory) === 'allow';
    });
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (AUTO_ALLOW.has(permission)) return callback(true);
      if (!ASK[permission]) return callback(false);
      let origin;
      try { origin = new URL(details.requestingUrl).origin; } catch { return callback(false); }
      if (!/^https?:/i.test(origin)) return callback(false); // zentro:// and file:// pages get nothing
      const saved = this._saved(origin, permission, isPrivate, memory);
      if (saved) return callback(saved === 'allow');
      const tab = this.ctx.tabForWebContentsId(wc.id);
      if (!tab) return callback(false);
      tab.win.askPermission({ origin, permission, label: ASK[permission], tab }, (allow, remember) => {
        if (remember) {
          if (isPrivate) memory.set(`${origin}|${permission}`, allow ? 'allow' : 'deny');
          else this.ctx.profile.setSitePermission(origin, permission, allow ? 'allow' : 'deny');
        }
        callback(allow);
      });
      return undefined;
    });
  }
}

module.exports = { Permissions, PERMISSION_LABELS: ASK };
