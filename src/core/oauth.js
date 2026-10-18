'use strict';
/** Google OAuth for desktop apps (system browser + loopback redirect + PKCE). Pure helpers, no Electron. */
const crypto = require('crypto');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makePkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), state: b64url(crypto.randomBytes(16)) };
}

function googleAuthUrl({ clientId, redirectUri, challenge, state }) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Reads the redirect Google sends to our loopback server. Returns { code } or { error }. */
function readCallback(reqUrl, expectedState) {
  let u;
  try { u = new URL(reqUrl, 'http://127.0.0.1'); } catch { return { error: 'Invalid response.' }; }
  if (u.pathname !== '/') return { ignore: true };
  if (u.searchParams.get('state') !== expectedState) return { error: 'Sign-in was not started by this app.' };
  if (u.searchParams.get('error')) return { error: u.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google refused the sign-in.' };
  const code = u.searchParams.get('code');
  return code && code.length < 2048 ? { code } : { error: 'Google did not return a sign-in code.' };
}

module.exports = { makePkce, googleAuthUrl, readCallback };
