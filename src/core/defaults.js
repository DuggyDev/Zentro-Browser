'use strict';
/** Default settings and strict validation of settings changes. Pure, no Electron. */
const path = require('path');
const { SEARCH_ENGINES } = require('./urls');

class SettingsError extends Error {
  constructor(m) { super(m); this.expose = true; }
}

const BUILTIN_PANELS = {
  bookmarks: { name: 'Bookmarks', url: 'zentro://bookmarks/?panel=1' },
  history: { name: 'History', url: 'zentro://history/?panel=1' },
  downloads: { name: 'Downloads', url: 'zentro://downloads/?panel=1' },
  collections: { name: 'Collections', url: 'zentro://collections/?panel=1' },
};

const ACCENTS = ['red', 'ember', 'rose', 'steel'];
const AVATAR_STYLES = ['aurora', 'pulse', 'orbit', 'flow', 'sparkle'];
const AI_PROVIDERS = ['chatgpt', 'claude', 'gemini', 'grok', 'custom'];
const TAB_LAYOUTS = ['horizontal', 'vertical', 'right', 'bottom'];   // top, left, right, bottom
/** Sites School Mode keeps closed while you study (editable in Settings). */
const DEFAULT_BLOCKLIST = ['tiktok.com', 'instagram.com', 'facebook.com', 'snapchat.com', 'twitch.tv', 'netflix.com', 'discord.com', 'roblox.com', 'store.steampowered.com', 'fortnite.com', 'twitter.com', 'x.com'];

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',
  accent: 'red',
  searchEngine: 'google',
  homepage: 'zentro://newtab/',
  startup: 'restore',
  tabLayout: 'horizontal',
  downloadDir: null,
  notifications: true,
  forceDark: true,
  animations: true,
  profile: { displayName: '', schoolName: '', grade: '' },
  school: { enabled: false, blockDistractions: true, blocklist: DEFAULT_BLOCKLIST },
  ai: { enabled: true, provider: 'chatgpt', customName: '', customUrl: '' },
  avatar: { style: 'aurora', image: false, rev: 0 },
  homeLogo: { image: false, rev: 0 },
  sounds: { enabled: true, volume: 40 },
  sidebar: {
    enabled: true,
    mode: 'compact',
    items: Object.entries(BUILTIN_PANELS).map(([id, p]) => ({ id, name: p.name, url: p.url, mode: 'panel', builtin: true })),
  },
  shield: { enabled: true, blockTrackers: true, thirdPartyCookies: 'allow', blockThirdPartyInPrivate: true, httpsFirst: true, siteOff: [] },
  sleep: { enabled: false, minutes: 30 },
  newtab: {
    showRecent: true,
    showStats: true,
    background: 'ember',
    wallpaper: null,
    speedDial: [
      { id: 'sd1', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
      { id: 'sd2', title: 'GitHub', url: 'https://github.com/' },
      { id: 'sd3', title: 'YouTube', url: 'https://www.youtube.com/' },
      { id: 'sd4', title: 'Reddit', url: 'https://www.reddit.com/' },
      { id: 'sd5', title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
      { id: 'sd6', title: 'Mozilla', url: 'https://www.mozilla.org/' },
    ],
  },
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function oneOf(v, list, label) { if (!list.includes(v)) throw new SettingsError(`Invalid ${label}.`); return v; }
function bool(v, label) { if (typeof v !== 'boolean') throw new SettingsError(`Invalid ${label}.`); return v; }
function text(v, max, label) { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new SettingsError(`Invalid ${label}.`); return v.trim(); }
function httpUrl(v, label) {
  try {
    const u = new URL(v);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && String(v).length <= 2048) return u.href;
  } catch { /* fallthrough */ }
  throw new SettingsError(`${label} must be an http or https link.`);
}
const ID_RE = /^[a-z0-9_-]{1,40}$/i;

function sidebarItems(list) {
  if (!Array.isArray(list) || list.length > 16) throw new SettingsError('Too many sidebar items.');
  const seen = new Set();
  return list.map((it) => {
    if (!isObj(it) || typeof it.id !== 'string' || !ID_RE.test(it.id) || seen.has(it.id)) throw new SettingsError('Invalid sidebar item.');
    seen.add(it.id);
    const mode = oneOf(it.mode, ['panel', 'tab'], 'sidebar mode');
    if (it.builtin) {
      const b = BUILTIN_PANELS[it.id];
      if (!b) throw new SettingsError('Unknown built-in sidebar item.');
      return { id: it.id, name: b.name, url: b.url, mode, builtin: true };
    }
    return { id: it.id, name: text(it.name, 40, 'sidebar name'), url: httpUrl(it.url, 'Sidebar link'), mode, builtin: false };
  });
}

function speedDial(list) {
  if (!Array.isArray(list) || list.length > 24) throw new SettingsError('Too many speed-dial tiles.');
  const seen = new Set();
  return list.map((t) => {
    if (!isObj(t) || typeof t.id !== 'string' || !ID_RE.test(t.id) || seen.has(t.id)) throw new SettingsError('Invalid speed-dial tile.');
    seen.add(t.id);
    return { id: t.id, title: text(t.title, 60, 'tile name'), url: httpUrl(t.url, 'Tile link') };
  });
}

function hostList(list) {
  if (!Array.isArray(list) || list.length > 500) throw new SettingsError('Invalid site list.');
  return [...new Set(list.map((h) => {
    if (typeof h !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(h)) throw new SettingsError('Invalid site name.');
    return h.toLowerCase();
  }))];
}

/** Returns a new, fully valid settings object = current + patch. Throws SettingsError on anything odd. */
function sanitizeSettings(patch, current) {
  if (!isObj(patch)) throw new SettingsError('Invalid settings.');
  const out = clone(current);
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'theme': out.theme = oneOf(v, ['dark', 'light', 'system'], 'theme'); break;
      case 'accent': out.accent = oneOf(v, ACCENTS, 'accent'); break;
      case 'searchEngine': out.searchEngine = oneOf(v, Object.keys(SEARCH_ENGINES), 'search engine'); break;
      case 'homepage': out.homepage = v === 'zentro://newtab/' ? v : httpUrl(v, 'Homepage'); break;
      case 'startup': out.startup = oneOf(v, ['restore', 'newtab', 'homepage'], 'startup option'); break;
      case 'tabLayout': out.tabLayout = oneOf(v, TAB_LAYOUTS, 'tab layout'); break;
      case 'notifications': out.notifications = bool(v, 'notification setting'); break;
      case 'forceDark': out.forceDark = bool(v, 'dark mode setting'); break;
      case 'animations': out.animations = bool(v, 'animation setting'); break;
      case 'ai':
        if (!isObj(v)) throw new SettingsError('Invalid AI settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'enabled') out.ai.enabled = bool(sv, 'AI setting');
          else if (sk === 'provider') out.ai.provider = oneOf(sv, AI_PROVIDERS, 'AI assistant');
          else if (sk === 'customName') out.ai.customName = sv === '' ? '' : text(sv, 30, 'AI name');
          else if (sk === 'customUrl') {
            if (sv === '') out.ai.customUrl = '';
            else { const u = httpUrl(sv, 'AI link'); if (!u.startsWith('https://')) throw new SettingsError('The AI link must start with https://'); out.ai.customUrl = u; }
          } else throw new SettingsError('Unknown AI setting.');
        }
        break;
      case 'sounds':
        if (!isObj(v)) throw new SettingsError('Invalid sound settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'enabled') out.sounds.enabled = bool(sv, 'sound setting');
          else if (sk === 'volume') { if (!Number.isInteger(sv) || sv < 0 || sv > 100) throw new SettingsError('Volume is 0 to 100.'); out.sounds.volume = sv; }
          else throw new SettingsError('Unknown sound setting.');
        }
        break;
      case 'homeLogo':
        if (!isObj(v)) throw new SettingsError('Invalid logo setting.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'image') out.homeLogo.image = bool(sv, 'logo setting');
          else if (sk === 'rev') { if (!Number.isInteger(sv) || sv < 0 || sv > 1e9) throw new SettingsError('Invalid logo setting.'); out.homeLogo.rev = sv; }
          else throw new SettingsError('Unknown logo setting.');
        }
        break;
      case 'avatar':
        if (!isObj(v)) throw new SettingsError('Invalid profile picture settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'style') out.avatar.style = oneOf(sv, AVATAR_STYLES, 'profile picture style');
          else if (sk === 'image') out.avatar.image = bool(sv, 'profile picture setting');
          else if (sk === 'rev') { if (!Number.isInteger(sv) || sv < 0 || sv > 1e9) throw new SettingsError('Invalid profile picture setting.'); out.avatar.rev = sv; }
          else throw new SettingsError('Unknown profile picture setting.');
        }
        break;
      case 'profile':
        if (!isObj(v)) throw new SettingsError('Invalid profile.');
        for (const [sk, sv] of Object.entries(v)) {
          if (!['displayName', 'schoolName', 'grade'].includes(sk)) throw new SettingsError('Unknown profile setting.');
          if (typeof sv !== 'string' || sv.length > 40 || /[\u0000-\u001f<>]/.test(sv)) throw new SettingsError('That text is too long or has characters that are not allowed.');
          out.profile[sk] = sv.trim();
        }
        break;
      case 'school':
        if (!isObj(v)) throw new SettingsError('Invalid School Mode settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'enabled' || sk === 'blockDistractions') out.school[sk] = bool(sv, 'School Mode setting');
          else if (sk === 'blocklist') out.school.blocklist = hostList(sv);
          else throw new SettingsError('Unknown School Mode setting.');
        }
        break;
      case 'downloadDir':
        if (v === null) out.downloadDir = null;
        else if (typeof v === 'string' && path.isAbsolute(v) && v.length <= 200 && !/[\u0000-\u001f]/.test(v)) out.downloadDir = path.normalize(v);
        else throw new SettingsError('Choose a full folder path.');
        break;
      case 'sidebar':
        if (!isObj(v)) throw new SettingsError('Invalid sidebar settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'enabled') out.sidebar.enabled = bool(sv, 'sidebar setting');
          else if (sk === 'mode') out.sidebar.mode = oneOf(sv, ['compact', 'expanded'], 'sidebar mode');
          else if (sk === 'items') out.sidebar.items = sidebarItems(sv);
          else throw new SettingsError('Unknown sidebar setting.');
        }
        break;
      case 'shield':
        if (!isObj(v)) throw new SettingsError('Invalid Shield settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (['enabled', 'blockTrackers', 'blockThirdPartyInPrivate', 'httpsFirst'].includes(sk)) out.shield[sk] = bool(sv, 'Shield setting');
          else if (sk === 'thirdPartyCookies') out.shield.thirdPartyCookies = oneOf(sv, ['allow', 'block'], 'cookie setting');
          else if (sk === 'siteOff') out.shield.siteOff = hostList(sv);
          else throw new SettingsError('Unknown Shield setting.');
        }
        break;
      case 'sleep':
        if (!isObj(v)) throw new SettingsError('Invalid sleep settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'enabled') out.sleep.enabled = bool(sv, 'sleep setting');
          else if (sk === 'minutes') {
            if (!Number.isInteger(sv) || sv < 5 || sv > 240) throw new SettingsError('Sleep time must be 5 to 240 minutes.');
            out.sleep.minutes = sv;
          } else throw new SettingsError('Unknown sleep setting.');
        }
        break;
      case 'newtab':
        if (!isObj(v)) throw new SettingsError('Invalid new tab settings.');
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'showRecent' || sk === 'showStats') out.newtab[sk] = bool(sv, 'new tab setting');
          else if (sk === 'background') out.newtab.background = oneOf(sv, ['ember', 'graphite', 'midnight', 'custom'], 'background');
          else if (sk === 'wallpaper') {
            if (sv !== null && !(typeof sv === 'string' && /^[a-f0-9]{12}$/.test(sv))) throw new SettingsError('Invalid background.');
            out.newtab.wallpaper = sv;
          } else if (sk === 'speedDial') out.newtab.speedDial = speedDial(sv);
          else throw new SettingsError('Unknown new tab setting.');
        }
        break;
      default: throw new SettingsError(`Unknown setting: ${String(k).slice(0, 40)}`);
    }
  }
  return out;
}

module.exports = { TAB_LAYOUTS, DEFAULT_BLOCKLIST, DEFAULT_SETTINGS, BUILTIN_PANELS, ACCENTS, AVATAR_STYLES, AI_PROVIDERS, SettingsError, sanitizeSettings, clone };
