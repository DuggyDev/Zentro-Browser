'use strict';
/**
 * Zentro account: email + password and "Continue with Google", through Firebase Authentication.
 * The refresh token is stored encrypted with the operating system (Electron safeStorage). If the OS cannot
 * encrypt, nothing is stored and the user simply signs in again next time.
 */
const http = require('http');
const { safeStorage, shell } = require('electron');
const cfg = require('../core/config');
const { JsonStore } = require('../core/store');
const { makePkce, googleAuthUrl, readCallback } = require('../core/oauth');
const { fetchJson } = require('./http');

const IDT = 'https://identitytoolkit.googleapis.com/v1';
const fail = (m) => Object.assign(new Error(m), { expose: true });
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const FIREBASE_ERRORS = {
  EMAIL_EXISTS: 'There is already an account with this email. Try signing in.',
  EMAIL_NOT_FOUND: 'Wrong email or password.', INVALID_PASSWORD: 'Wrong email or password.', INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
  USER_DISABLED: 'This account has been disabled.', INVALID_EMAIL: 'That email address does not look right.',
  WEAK_PASSWORD: 'Choose a stronger password (at least 8 characters).', TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
  OPERATION_NOT_ALLOWED: 'This sign-in method is not turned on in Firebase yet.', INVALID_IDP_RESPONSE: 'Google sign-in failed. Please try again.',
};
function firebaseError(res) {
  const code = String((res.json && res.json.error && res.json.error.message) || '').split(' ')[0];
  return fail(FIREBASE_ERRORS[code] || 'Something went wrong. Check your connection and try again.');
}

class Account {
  constructor(file) {
    this.store = new JsonStore(file);
    this.store.load();
    this.user = null;       // { uid, email, name, emailVerified }
    this.idToken = null;
    this.expiresAt = 0;
    this.refreshToken = null;
    this.offline = false;
    this.googleBusy = false;
  }

  // ---------------------------------------------------------------- status
  configured() { return !!cfg.FIREBASE_API_KEY; }
  googleConfigured() { return this.configured() && !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET; }
  signedIn() { return !!this.user; }
  shouldPrompt() { return this.configured() && !this.user && !(cfg.ALLOW_SKIP_LOGIN && this.store.get('skipped', false)); }
  publicState() {
    const u = this.user;
    return {
      configured: this.configured(), googleConfigured: this.googleConfigured(), allowSkip: !!cfg.ALLOW_SKIP_LOGIN,
      signedIn: !!u, email: u ? u.email : '', name: u ? u.name : '', emailVerified: !!(u && u.emailVerified), offline: this.offline,
    };
  }
  skip() { if (!cfg.ALLOW_SKIP_LOGIN) throw fail('An account is required.'); this.store.set('skipped', true); this.store.flush(); }

  // ---------------------------------------------------------------- storage
  _enc(text) { try { return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null; } catch { return null; } }
  _dec(b64) { try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return null; } }
  _persist() {
    const u = this.user;
    const rt = u && this.refreshToken ? this._enc(this.refreshToken) : null;
    this.store.set('session', u && rt ? { uid: u.uid, email: u.email, name: u.name, emailVerified: u.emailVerified, rt } : null);
    this.store.flush();
  }

  /** Called once at start-up: signs back in with the stored refresh token. */
  async restore() {
    const s = this.store.get('session', null);
    if (!this.configured() || !s || typeof s.rt !== 'string') return;
    const rt = this._dec(s.rt);
    if (!rt) return;
    this.refreshToken = rt;
    try {
      await this._refresh();
      this.user = { uid: s.uid, email: s.email, name: s.name || '', emailVerified: !!s.emailVerified };
      await this.reloadProfile().catch(() => {});
    } catch (err) {
      if (err && err.fatalAuth) { this.signOut(); return; }
      this.user = { uid: s.uid, email: s.email, name: s.name || '', emailVerified: !!s.emailVerified }; // offline: keep the cached identity
      this.offline = true;
    }
  }

  // ---------------------------------------------------------------- tokens
  async _refresh() {
    const r = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken }).toString(),
    });
    if (!r.ok || !r.json || !r.json.id_token) {
      const e = new Error('refresh failed');
      e.fatalAuth = r.status >= 400 && r.status < 500;
      throw e;
    }
    this.idToken = r.json.id_token;
    this.refreshToken = r.json.refresh_token || this.refreshToken;
    this.expiresAt = Date.now() + Number(r.json.expires_in || 3600) * 1000;
    this.offline = false;
  }
  /** A valid Firebase ID token for calls to the Zentro server, or null when signed out. */
  async getIdToken() {
    if (!this.user) return null;
    if (!this.idToken || Date.now() > this.expiresAt - 60000) {
      try { await this._refresh(); } catch (err) { if (err && err.fatalAuth) { this.signOut(); } return null; }
    }
    return this.idToken;
  }

  async reloadProfile() {
    const r = await fetchJson(`${IDT}/accounts:lookup?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: this.idToken }),
    });
    const u = r.ok && r.json && r.json.users && r.json.users[0];
    if (!u || !this.user) return;
    this.user.emailVerified = !!u.emailVerified;
    this.user.email = u.email || this.user.email;
    this.user.name = u.displayName || this.user.name;
    this._persist();
  }

  async _adopt(json) {
    if (!json || !json.idToken || !json.refreshToken || !json.localId) throw fail('Sign-in failed. Please try again.');
    this.idToken = json.idToken;
    this.refreshToken = json.refreshToken;
    this.expiresAt = Date.now() + Number(json.expiresIn || 3600) * 1000;
    this.user = { uid: String(json.localId), email: String(json.email || ''), name: String(json.displayName || ''), emailVerified: !!json.emailVerified };
    this.offline = false;
    await this.reloadProfile().catch(() => {});
    this._persist();
  }

  // ---------------------------------------------------------------- email + password
  _check(email, password, strictPassword) {
    if (!this.configured()) throw fail('Accounts are not set up yet. The developer still has to fill in the Firebase key (see SETUP.md).');
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) throw fail('That email address does not look right.');
    if (password !== undefined && (typeof password !== 'string' || password.length > 128 || (strictPassword && password.length < 8))) throw fail(strictPassword ? 'Use a password of at least 8 characters.' : 'Enter your password.');
    return email.trim().toLowerCase();
  }
  async _password(kind, email, password) {
    const r = await fetchJson(`${IDT}/accounts:${kind}?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    }).catch(() => { throw fail('Could not reach the sign-in service. Check your connection.'); });
    if (!r.ok) throw firebaseError(r);
    return r.json;
  }
  async signUp(email, password) {
    const e = this._check(email, password, true);
    await this._adopt(await this._password('signUp', e, password));
    await this.resendVerification().catch(() => {});
    return this.publicState();
  }
  async signIn(email, password) {
    const e = this._check(email, password, false);
    await this._adopt(await this._password('signInWithPassword', e, password));
    return this.publicState();
  }
  async resetPassword(email) {
    const e = this._check(email);
    await fetchJson(`${IDT}/accounts:sendOobCode?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: e }),
    }).catch(() => { throw fail('Could not reach the sign-in service. Check your connection.'); });
    return true; // always "sent", so the answer never reveals which emails have an account
  }
  async resendVerification() {
    const token = await this.getIdToken();
    if (!token) throw fail('Sign in first.');
    const r = await fetchJson(`${IDT}/accounts:sendOobCode?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: token }),
    }).catch(() => { throw fail('Could not reach the sign-in service. Check your connection.'); });
    if (!r.ok) throw firebaseError(r);
    return true;
  }
  async refreshProfile() {
    if (!(await this.getIdToken())) throw fail('Sign in first.');
    await this.reloadProfile();
    return this.publicState();
  }

  // ---------------------------------------------------------------- Google (system browser + loopback + PKCE)
  async signInGoogle() {
    if (!this.googleConfigured()) throw fail('Google sign-in is not set up yet (see SETUP.md).');
    if (this.googleBusy) throw fail('A Google sign-in window is already open. Finish it or wait a moment.');
    this.googleBusy = true;
    const pk = makePkce();
    const server = http.createServer();
    let redirectUri = '';
    try {
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(fail('Sign-in took too long. Please try again.')), 180000);
        server.on('request', (req, res) => {
          const r = readCallback(req.url, pk.state);
          if (r.ignore) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Zentro</title><body style="background:#0a0a0c;color:#f2f2f5;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#ff4a5c">Zentro Browser</h2><p>${r.error ? 'Sign-in failed. You can close this tab and try again.' : 'You are signed in. You can close this tab and go back to Zentro.'}</p></div>`);
          clearTimeout(timer);
          if (r.error) reject(fail(r.error)); else resolve(r.code);
        });
        server.on('error', () => { clearTimeout(timer); reject(fail('Could not start the local sign-in listener.')); });
        server.listen(0, '127.0.0.1', () => {
          redirectUri = `http://127.0.0.1:${server.address().port}`;
          shell.openExternal(googleAuthUrl({ clientId: cfg.GOOGLE_CLIENT_ID, redirectUri, challenge: pk.challenge, state: pk.state })).catch(() => reject(fail('Could not open your browser.')));
        });
      });
      const tok = await fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: cfg.GOOGLE_CLIENT_ID, client_secret: cfg.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: pk.verifier }).toString(),
      }).catch(() => { throw fail('Could not reach Google. Check your connection.'); });
      if (!tok.ok || !tok.json || !tok.json.id_token) throw fail('Google did not accept the sign-in. Please try again.');
      const fb = await fetchJson(`${IDT}/accounts:signInWithIdp?key=${encodeURIComponent(cfg.FIREBASE_API_KEY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postBody: `id_token=${tok.json.id_token}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }),
      }).catch(() => { throw fail('Could not reach the sign-in service. Check your connection.'); });
      if (!fb.ok) throw firebaseError(fb);
      await this._adopt(fb.json);
      return this.publicState();
    } finally {
      this.googleBusy = false;
      try { server.close(); } catch { /* closed */ }
    }
  }

  signOut() {
    this.user = null; this.idToken = null; this.refreshToken = null; this.expiresAt = 0; this.offline = false;
    this.store.set('session', null);
    this.store.set('skipped', false);
    this.store.flush();
  }
}

module.exports = { Account };
