'use strict';
/** Zentro chat rules (no network, no dependencies): rooms, cleaning text, name tags and rate limits. */
const crypto = require('crypto');

const ROOMS = Object.freeze({ general: 'General', school: 'School & homework', help: 'Help' });
const MAX_TEXT = 400;
const KEEP = 200;

/** Plain text only: no control characters, no clickable links (people are often young), one blank line at most. */
function cleanText(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/(https?:\/\/|www\.)\S+/gi, '[link removed]')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

function cleanName(v) {
  const n = String(v == null ? '' : v).replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return n || 'Student';
}

/** Four characters that belong to the account, so nobody can pretend to be someone else with the same name. */
const tagFor = (uid) => crypto.createHash('sha256').update(`zentro-chat:${uid}`).digest('hex').slice(0, 4);

class Chat {
  constructor() {
    this.epoch = crypto.randomBytes(4).toString('hex');
    this.rooms = new Map(Object.keys(ROOMS).map((r) => [r, { next: 1, list: [] }]));
    this.last = new Map();            // uid -> { at, times: [] }
  }
  hasRoom(r) { return this.rooms.has(r); }
  /** Returns { ok: true, message } or { ok: false, reason: 'empty' | 'slow' | 'room' }. */
  add(room, who, name, text, now = Date.now()) {
    const r = this.rooms.get(room);
    if (!r) return { ok: false, reason: 'room' };
    const clean = cleanText(text);
    if (!clean) return { ok: false, reason: 'empty' };
    const l = this.last.get(who.uid) || { at: -1e15, times: [] };
    l.times = l.times.filter((t) => now - t < 60000);
    if (now - l.at < 1200 || l.times.length >= 30) return { ok: false, reason: 'slow' };
    l.at = now; l.times.push(now); this.last.set(who.uid, l);
    if (this.last.size > 5000) for (const [k, v] of this.last) if (now - v.at > 120000) this.last.delete(k);
    const message = { id: r.next++, at: now, name: cleanName(name), tag: tagFor(who.uid), text: clean };
    r.list.push(message);
    if (r.list.length > KEEP) r.list.shift();
    return { ok: true, message };
  }
  /** New messages after `after`. A client with an old epoch (the server restarted) gets everything again. */
  since(room, after, epoch) {
    const r = this.rooms.get(room);
    if (!r) return null;
    const from = epoch === this.epoch && Number.isInteger(after) && after >= 0 ? after : 0;
    return { epoch: this.epoch, messages: r.list.filter((m) => m.id > from).slice(-100) };
  }
}

module.exports = { ROOMS, MAX_TEXT, cleanText, cleanName, tagFor, Chat };
