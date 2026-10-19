'use strict';
/** Zentro chat client: talks to the Zentro server (server/) with the signed-in account. Text only. */
const cfg = require('../core/config');
const { fetchJson } = require('./http');

const fail = (m) => Object.assign(new Error(m), { expose: true });
const ROOMS = [['general', 'General'], ['school', 'School & homework'], ['help', 'Help']];

class ChatClient {
  constructor(z) { this.z = z; }
  rooms() { return ROOMS.map(([id, name]) => ({ id, name })); }
  _base() {
    if (!cfg.API_BASE) throw fail('Chat needs the Zentro server. The developer has to set API_BASE in src/core/config.js (see SETUP.md).');
    return cfg.API_BASE.replace(/\/+$/, '');
  }
  async _token() {
    const acc = this.z.account;
    if (!acc.signedIn()) throw fail('Sign in to your Zentro account to use chat.');
    if (!acc.user.emailVerified) throw fail('Verify your email address first (check your inbox), then open chat again.');
    const t = await acc.getIdToken();
    if (!t) throw fail('Could not reach your account. Check your connection.');
    return t;
  }
  _explain(r) {
    if (r.status === 429) return fail('Slow down a little.');
    if (r.status === 401) return fail('Please sign in again.');
    if (r.status === 403) return fail('Verify your email address first.');
    if (r.status === 400) return fail('That message can\u2019t be sent.');
    return fail('Chat is not reachable right now.');
  }
  name() {
    const p = this.z.profile.settings.profile;
    const a = this.z.account.publicState();
    return (p.displayName || a.name || (a.email || '').split('@')[0] || 'Student').slice(0, 24);
  }
  async list(room, after, epoch) {
    const token = await this._token();
    const q = new URLSearchParams({ after: String(after), epoch });
    let r;
    try { r = await fetchJson(`${this._base()}/api/chat/${encodeURIComponent(room)}?${q}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }); } catch (e) { if (e.expose) throw e; throw fail('Chat is not reachable right now.'); }
    if (!r.ok || !r.json || !Array.isArray(r.json.messages)) throw this._explain(r);
    return { epoch: String(r.json.epoch || ''), me: this.name(), messages: r.json.messages.slice(-100).map((m) => ({ id: m.id, at: m.at, name: String(m.name).slice(0, 24), tag: String(m.tag).slice(0, 4), text: String(m.text).slice(0, 400) })) };
  }
  async send(room, text) {
    const token = await this._token();
    let r;
    try { r = await fetchJson(`${this._base()}/api/chat/${encodeURIComponent(room)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, name: this.name() }), timeout: 8000 }); } catch (e) { if (e.expose) throw e; throw fail('Chat is not reachable right now.'); }
    if (!r.ok) throw this._explain(r);
    return true;
  }
}

module.exports = { ChatClient, ROOMS };
