'use strict';
/** Domain blocklist used by Zentro Shield. Pure, no Electron. */

class Blocklist {
  constructor() { this.domains = new Set(); }

  /** Accepts hosts-file lines ("0.0.0.0 ads.example.com") or one domain per line. Returns how many were added. */
  addText(text) {
    let added = 0;
    for (const line of String(text).split(/\r?\n/)) {
      let l = line.replace(/\s+#.*$/, '').trim();
      if (!l || l[0] === '#' || l[0] === '!') continue;
      const parts = l.split(/\s+/);
      l = parts.length >= 2 && /^(0\.0\.0\.0|127\.0\.0\.1)$/.test(parts[0]) ? parts[1] : parts[0];
      l = l.toLowerCase();
      if (l === 'localhost' || !/^[a-z0-9._-]+\.[a-z]{2,}$/.test(l)) continue;
      this.domains.add(l);
      added++;
    }
    return added;
  }

  get size() { return this.domains.size; }

  matches(host) {
    const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      if (this.domains.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  }
}

module.exports = { Blocklist };
