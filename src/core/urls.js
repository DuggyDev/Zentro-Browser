'use strict';
/** Address-bar parsing and site helpers. Pure functions, no Electron. */

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
};

const INTERNAL_HOSTS = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'collections', 'extensions', 'reader', 'error', 'account', 'school', 'chat']);

const COMMON_TLDS = new Set(('com net org io co nl de uk fr es it eu be ru jp cn in br au ca us dev app ai me tv xyz info biz edu gov mil ' +
  'nu se no dk fi pl ch at cz pt gr tr kr tw hk sg nz za mx ar cl id ph vn th my ie ua ro hu gg to ly gl sh cc ws fm im so pro online ' +
  'site store tech club live news blog cloud wiki page link').split(' '));

// Public suffixes with two labels (approximation of the Public Suffix List).
const MULTI_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'co.jp', 'ne.jp', 'or.jp',
  'co.nz', 'co.za', 'com.br', 'com.cn', 'com.mx', 'com.ar', 'co.in', 'com.tr', 'com.sg', 'co.kr', 'com.hk', 'com.tw', 'co.id', 'com.ua',
  'github.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'blogspot.com', 'pages.dev', 'web.app', 'firebaseapp.com', 'workers.dev', 'azurewebsites.net']);

function isIPv4(h) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(h) && h.split('.').every((n) => Number(n) <= 255);
}

function isLocalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h.includes(':')) return true; // IPv6 literal
  if (isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return false;
}

function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || isIPv4(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return MULTI_SUFFIXES.has(last2) ? p.slice(-3).join('.') : last2;
}

function isThirdParty(requestHost, topHost) {
  return registrableDomain(requestHost) !== registrableDomain(topHost);
}

/**
 * Turn what the user typed into a URL or a search.
 * @returns {{url:string,isSearch:boolean}|null}
 */
function resolveInput(raw, engine = 'google') {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const search = () => ({
    url: (SEARCH_ENGINES[engine] || SEARCH_ENGINES.google).url.replace('%s', encodeURIComponent(text)),
    isSearch: true,
  });
  if (/\s/.test(text)) return search();

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http' || s === 'https') {
      try { const u = new URL(text); if (u.hostname) return { url: u.href, isSearch: false }; } catch { /* search */ }
      return search();
    }
    if (s === 'file') { try { return { url: new URL(text).href, isSearch: false }; } catch { return search(); } }
    if (s === 'zentro') {
      try { const u = new URL(text); if (INTERNAL_HOSTS.has(u.hostname)) return { url: u.href, isSearch: false }; } catch { /* search */ }
      return search();
    }
    if (text.toLowerCase() === 'about:blank') return { url: 'about:blank', isSearch: false };
    // "localhost:3000" or "host:8080/x" look like a scheme but are host:port
    if (!/^[^:/]+:\d+(\/|$)/.test(text)) return search();
  }

  const m = /^(\[[0-9a-f:.]+\]|[^\s/?#:@]+)(:\d{1,5})?([/?#]\S*)?$/iu.exec(text);
  if (!m) return search();
  const host = m[1].toLowerCase();
  const hasPortOrPath = !!(m[2] || m[3]);
  let ok = false;
  if (host === 'localhost' || isIPv4(host) || host.startsWith('[')) ok = true;
  else if (/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(host)) {
    const tld = host.slice(host.lastIndexOf('.') + 1);
    ok = hasPortOrPath ? /^(\p{L}{2,}|xn--[a-z0-9-]+)$/u.test(tld) : COMMON_TLDS.has(tld) || tld.startsWith('xn--');
  }
  if (!ok) return search();
  try { return { url: new URL((isLocalHost(host) ? 'http://' : 'https://') + text).href, isSearch: false }; } catch { return search(); }
}

/** Text shown in the address bar. New tab and error pages show a clean bar. */
function displayUrl(url) {
  if (!url || url === 'about:blank') return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'zentro:') {
      if (u.hostname === 'newtab') return '';
      if (u.hostname === 'error') return u.searchParams.get('url') || '';
      return `zentro://${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    }
  } catch { /* plain */ }
  return url;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

module.exports = { SEARCH_ENGINES, INTERNAL_HOSTS, resolveInput, displayUrl, hostOf, isLocalHost, registrableDomain, isThirdParty };
