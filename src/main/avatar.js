'use strict';
/** Your profile picture: a PNG, JPG, WEBP or (animated) GIF kept in the profile folder, validated by file signature. */
const fs = require('fs');
const path = require('path');
const { sniffImage } = require('../core/images');

const MAX_BYTES = 8 * 1024 * 1024;
const bad = (m) => Object.assign(new Error(m), { expose: true });

class Avatar {
  constructor(dir, name = 'avatar') { this.dir = dir; this.name = name; fs.mkdirSync(dir, { recursive: true }); }
  file() {
    for (const ext of ['png', 'jpg', 'webp', 'gif']) { const f = path.join(this.dir, `${this.name}.${ext}`); if (fs.existsSync(f)) return f; }
    return null;
  }
  set(buf) {
    if (!buf || buf.length > MAX_BYTES) throw bad('That picture is larger than 8 MB.');
    const ext = sniffImage(buf);
    if (!['png', 'jpg', 'webp', 'gif'].includes(ext)) throw bad('Choose a PNG, JPG, WEBP or GIF picture.');
    this.clear();
    fs.writeFileSync(path.join(this.dir, `${this.name}.${ext}`), buf);
  }
  setFromFile(p) {
    if (fs.statSync(p).size > MAX_BYTES) throw bad('That picture is larger than 8 MB.');
    this.set(fs.readFileSync(p));
  }
  clear() { const f = this.file(); if (f) fs.unlinkSync(f); }
}

module.exports = { Avatar };
