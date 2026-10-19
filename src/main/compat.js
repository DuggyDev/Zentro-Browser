'use strict';
/** Small compatibility helpers so sites treat Zentro like a normal Chromium browser. */
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
// Google's sign-in refuses Chromium-based embedded browsers, but accepts a Firefox-style identity.
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const AUTH_HOSTS = new Set(['accounts.google.com', 'accounts.youtube.com']);

function isGoogleAuth(url) {
  try { return AUTH_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/** Request headers for Google sign-in pages: Firefox identity and no Chromium client hints. null = not applicable. */
function googleAuthHeaders(url, headers) {
  if (!isGoogleAuth(url)) return null;
  const h = { ...headers };
  for (const k of Object.keys(h)) {
    const l = k.toLowerCase();
    if (l === 'user-agent' || l.startsWith('sec-ch-ua')) delete h[k];
  }
  h['User-Agent'] = FIREFOX_UA;
  return h;
}

module.exports = { CHROME_UA, FIREFOX_UA, isGoogleAuth, googleAuthHeaders };
