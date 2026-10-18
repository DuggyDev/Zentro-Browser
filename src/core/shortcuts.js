'use strict';
/** Maps a keyboard event (Electron "before-input-event" input) to a browser action name, or null. */
function actionFor(input) {
  const key = String(input.key || '').toLowerCase();
  const ctrl = !!(input.control || input.meta);
  const shift = !!input.shift;
  const alt = !!input.alt;

  if (ctrl && alt && !shift && /^[1-9]$/.test(key)) return `sidebar:${key}`;
  if (alt && !ctrl && !shift) {
    if (key === 'arrowleft') return 'back';
    if (key === 'arrowright') return 'forward';
    if (key === 'home') return 'home';
    if (key === 'd') return 'focus-address';
    return null;
  }
  if (!ctrl && !alt) {
    if (key === 'f5') return 'reload';
    if (key === 'f11') return 'fullscreen';
    if (key === 'f12') return 'devtools';
    return null;
  }
  if (alt) return null;
  if (key === 'f5') return 'reload:hard';
  if (/^[1-8]$/.test(key) && !shift) return `tab:index:${key}`;
  if (key === '9' && !shift) return 'tab:last';
  switch (key) {
    case 't': return shift ? 'tab:reopen' : 'tab:new';
    case 'w': return 'tab:close';
    case 'n': return shift ? 'window:private' : 'window:new';
    case 'l': return 'focus-address';
    case 'tab': return shift ? 'tab:prev' : 'tab:next';
    case 'pagedown': return 'tab:next';
    case 'pageup': return 'tab:prev';
    case 'r': return shift ? 'reload:hard' : 'reload';
    case 'f': return 'find';
    case 'd': return 'bookmark';
    case 'h': return 'history';
    case 'j': return 'downloads';
    case 'a': return shift ? 'ai:toggle' : null;
    case 'p': return 'print';
    case 'i': return shift ? 'devtools' : null;
    case 'delete': return shift ? 'clear-data' : null;
    case '+': case '=': return 'zoom:in';
    case '-': case '_': return 'zoom:out';
    case '0': return 'zoom:reset';
    default: return null;
  }
}

module.exports = { actionFor };
