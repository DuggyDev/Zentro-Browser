'use strict';
/**
 * Zentro VPN (Premium): sends all browser traffic through a proxy server run by the Zentro team.
 * It protects what THIS browser sends (websites see the server's IP). It is not a system-wide VPN.
 * Server addresses and passwords are only handed out by the Zentro server to accounts that have paid.
 */
const cfg = require('../core/config');
const { sanitizeServers, proxyRule, publicServer } = require('../core/vpn');
const { fetchJson } = require('./http');

const fail = (m) => Object.assign(new Error(m), { expose: true });

class Vpn {
  constructor(z) {
    this.z = z;
    this.current = null;           // the server we are connected to (with credentials, main process only)
    this.sessions = new Set();     // every web session whose traffic must go through the server
    this.busy = false;
  }
  track(ses) { this.sessions.add(ses); if (this.current) this._set(ses, this.current).catch(() => {}); }
  untrack(ses) { this.sessions.delete(ses); }

  publicState() {
    return { on: !!this.current, busy: this.busy, server: this.current ? publicServer(this.current) : null, serverConfigured: !!cfg.API_BASE };
  }

  async listServers() {
    const token = await this.z.account.getIdToken();
    if (!token) throw fail('Sign in to use the VPN.');
    if (!cfg.API_BASE) throw fail('The VPN server list is not set up yet (see SETUP.md).');
    let r;
    try { r = await fetchJson(`${cfg.API_BASE.replace(/\/+$/, '')}/api/vpn/servers`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw fail('Could not reach the Zentro server. Check your connection.'); }
    if (r.status === 402 || r.status === 403) throw fail('The VPN is part of Zentro Premium.');
    if (!r.ok || !r.json) throw fail('Could not load the VPN servers.');
    this.cache = sanitizeServers(r.json.servers);
    return this.cache;
  }

  async _set(ses, server) {
    if (server) await ses.setProxy({ mode: 'fixed_servers', proxyRules: proxyRule(server), proxyBypassRules: '<local>' });
    else await ses.setProxy({ mode: 'system' });
    await ses.closeAllConnections(); // old connections would keep going around the VPN
  }
  _webrtc() {
    // Without this, WebRTC can reveal the real IP address next to the proxy.
    const policy = this.current ? 'disable_non_proxied_udp' : 'default';
    for (const w of this.z.windows) for (const t of w.tabs) if (t.wc && !t.wc.isDestroyed()) t.wc.setWebRTCIPHandlingPolicy(policy);
  }
  applyToContents(wc) { try { wc.setWebRTCIPHandlingPolicy(this.current ? 'disable_non_proxied_udp' : 'default'); } catch { /* destroyed */ } }

  async connect(id) {
    if (!this.z.premium.state.premium) throw fail('The VPN is part of Zentro Premium.');
    if (this.busy) throw fail('Please wait a moment.');
    this.busy = true;
    this.z.broadcast('vpn-changed');
    try {
      const servers = await this.listServers();
      const s = servers.find((x) => x.id === id) || servers[0];
      if (!s) throw fail('No VPN servers are available right now.');
      this.current = s;
      for (const ses of this.sessions) await this._set(ses, s);
      this._webrtc();
      this.z.account.store.set('vpn', { on: true, id: s.id });
      this.z.account.store.flush();
      return this.publicState();
    } catch (err) {
      if (this.current) { this.current = null; for (const ses of this.sessions) await this._set(ses, null).catch(() => {}); }
      throw err;
    } finally {
      this.busy = false;
      this.z.broadcast('vpn-changed');
      this.z.pushAllStates();
    }
  }

  async disconnect() {
    const had = !!this.current;
    this.current = null;
    for (const ses of this.sessions) await this._set(ses, null).catch(() => {});
    this._webrtc();
    this.z.account.store.set('vpn', { on: false, id: (this.z.account.store.get('vpn', {}) || {}).id || null });
    this.z.account.store.flush();
    if (had) { this.z.broadcast('vpn-changed'); this.z.pushAllStates(); }
    return this.publicState();
  }

  wantsRestore() { const v = this.z.account.store.get('vpn', null); return !!(v && v.on && this.z.account.signedIn()); }
  /** At start-up, BEFORE the first page loads, so nothing is fetched outside the VPN. */
  async restore() {
    const v = this.z.account.store.get('vpn', null);
    try {
      await this.z.premium.refresh();
      if (this.z.premium.state.premium && v && v.on) await this.connect(v.id);
      else if (v && v.on) await this.disconnect();
    } catch { this.restoreFailed = true; }
  }

  /** Answers the proxy's password prompt for the server we chose (and only that server). */
  handleLogin(event, authInfo, callback) {
    const s = this.current;
    if (!s || !authInfo || !authInfo.isProxy || !s.username) return false;
    if (String(authInfo.host).toLowerCase() !== s.host || Number(authInfo.port) !== s.port) return false;
    event.preventDefault();
    callback(s.username, s.password);
    return true;
  }
}

module.exports = { Vpn };
