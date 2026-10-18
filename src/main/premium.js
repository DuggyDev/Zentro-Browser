'use strict';
/** Zentro Premium: asks the Zentro server (which checks Stripe) whether the signed-in account has paid. */
const { shell } = require('electron');
const cfg = require('../core/config');
const { fetchJson } = require('./http');

const fail = (m) => Object.assign(new Error(m), { expose: true });
const GRACE_MS = 72 * 3600 * 1000; // offline: a recent "yes" is trusted for 3 days

class Premium {
  constructor(z) {
    this.z = z;
    this.state = { premium: false, reason: 'signed-out', checkedAt: 0 };
  }
  serverConfigured() { return !!cfg.API_BASE; }
  publicState() { return { ...this.state, serverConfigured: this.serverConfigured(), buyConfigured: this.buyUrl(true) !== null }; }

  async refresh() {
    const acc = this.z.account;
    const prev = this.state.premium;
    if (!acc.signedIn()) this.state = { premium: false, reason: 'signed-out', checkedAt: Date.now() };
    else if (!this.serverConfigured()) this.state = { premium: false, reason: 'not-configured', checkedAt: Date.now() };
    else {
      const token = await acc.getIdToken();
      const cache = acc.store.get('premium', null);
      if (!token) this.state = { premium: false, reason: 'offline', checkedAt: Date.now() };
      else {
        try {
          const r = await fetchJson(`${cfg.API_BASE.replace(/\/+$/, '')}/api/premium`, { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok || !r.json) throw new Error('bad answer');
          this.state = { premium: r.json.premium === true, reason: r.json.premium ? null : String(r.json.reason || 'none').slice(0, 40), checkedAt: Date.now() };
          acc.store.set('premium', { uid: acc.user.uid, premium: this.state.premium, at: Date.now() });
          acc.store.flush();
        } catch {
          const ok = cache && cache.uid === acc.user.uid && cache.premium === true && Date.now() - cache.at < GRACE_MS;
          this.state = { premium: !!ok, reason: ok ? 'offline-cache' : 'offline', checkedAt: Date.now() };
        }
      }
    }
    if (prev && !this.state.premium) await this.z.vpn.disconnect().catch(() => {});
    this.z.broadcast('premium-changed');
    return this.publicState();
  }

  /** The Stripe link with this account's id and email filled in, or null. Only https://buy.stripe.com links are ever opened. */
  buyUrl(probe = false) {
    let u;
    try { u = new URL(cfg.STRIPE_PAYMENT_LINK); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname !== 'buy.stripe.com') return null;
    if (probe) return u.href;
    const user = this.z.account.user;
    if (!user) return null;
    u.searchParams.set('client_reference_id', user.uid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200));
    if (user.email) u.searchParams.set('prefilled_email', user.email);
    return u.href;
  }
  async buy() {
    const acc = this.z.account;
    if (!acc.signedIn()) throw fail('Sign in first, so your purchase is linked to your account.');
    if (!acc.user.emailVerified) throw fail('Verify your email address first (check your inbox), then buy Premium.');
    const url = this.buyUrl();
    if (!url) throw fail('The purchase link is not set up.');
    await shell.openExternal(url);
    return true;
  }
}

module.exports = { Premium };
