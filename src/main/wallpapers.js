'use strict';
/** Your own new-tab backgrounds: stored in the profile folder, validated by file signature. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sniffImage } = require('../core/images');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_COUNT = 12;
const bad = (m) => Object.assign(new Error(m), { expose: true });

class Wallpapers {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }

  list() {
    const out = [];
    for (const n of fs.readdirSync(this.dir)) {
      const m = /^([a-f0-9]{12})\.(png|jpg|webp)$/.exec(n);
      if (m) out.push({ id: m[1], ext: m[2], t: fs.statSync(path.join(this.dir, n)).mtimeMs });
    }
    return out.sort((a, b) => b.t - a.t);
  }

  file(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{12}$/.test(id)) return null;
    const e = this.list().find((x) => x.id === id);
    return e ? path.join(this.dir, `${id}.${e.ext}`) : null;
  }

  addBuffer(buf) {
    if (!buf || buf.length > MAX_BYTES) throw bad('That image is larger than 15 MB.');
    const ext = sniffImage(buf);
    if (!['png', 'jpg', 'webp'].includes(ext)) throw bad('Choose a PNG, JPG or WEBP image.');
    if (this.list().length >= MAX_COUNT) throw bad(`You can keep up to ${MAX_COUNT} backgrounds. Remove one first.`);
    const id = crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(path.join(this.dir, `${id}.${ext}`), buf);
    return id;
  }

  addFile(p) {
    if (fs.statSync(p).size > MAX_BYTES) throw bad('That image is larger than 15 MB.');
    return this.addBuffer(fs.readFileSync(p));
  }

  remove(id) {
    const f = this.file(id);
    if (f) fs.unlinkSync(f);
  }
}

module.exports = { Wallpapers };
