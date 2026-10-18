'use strict';
/** Chrome Web Store helpers: extension ids, CRX -> ZIP, and a small safe ZIP reader. Pure, no Electron, no dependencies. */
const zlib = require('zlib');
const path = require('path');

const ID_RE = /^[a-p]{32}$/;
const MAX_FILES = 3000;
const MAX_TOTAL = 150 * 1024 * 1024;

/** Accepts a bare 32-letter id or a Chrome Web Store link; anything else -> null. */
function extensionIdFrom(input) {
  const s = String(input || '').trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const okHost = (u.protocol === 'https:' && (u.hostname === 'chromewebstore.google.com' || u.hostname === 'chrome.google.com'));
  if (!okHost || !/^\/(webstore\/)?detail\//.test(u.pathname)) return null;
  const id = u.pathname.split('/').filter(Boolean).pop();
  return ID_RE.test(id) ? id : null;
}

function crxUrl(id, chromeVersion) {
  const x = encodeURIComponent(`id=${id}&installsource=ondemand&uc`);
  return `https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x86_64&nacl_arch=x86-64&prod=chromiumcrx&prodchannel=&prodversion=${encodeURIComponent(chromeVersion)}&lang=en-US&acceptformat=crx3&x=${x}`;
}

/** Strips the CRX2/CRX3 header and returns the ZIP bytes. */
function crxToZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Not a Chrome extension package.');
  const version = buf.readUInt32LE(4);
  let start;
  if (version === 3) start = 12 + buf.readUInt32LE(8);
  else if (version === 2) start = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
  else throw new Error('Unsupported extension package version.');
  if (start >= buf.length || buf.readUInt32LE(start) !== 0x04034b50) throw new Error('The extension package is damaged.');
  return buf.subarray(start);
}

/** Reads a ZIP into [{ name, data }]. Refuses paths that could escape the target folder. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The extension package is damaged.');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_FILES) throw new Error('The extension has too many files.');
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The extension package is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((s) => s === '..' || s === '')) throw new Error('The extension contains an unsafe file path.');
    total += usize;
    if (total > MAX_TOTAL) throw new Error('The extension is too large.');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 });
    else throw new Error('The extension uses an unsupported compression method.');
    if (data.length !== usize) throw new Error('The extension package is damaged.');
    out.push({ name, data });
  }
  return out;
}

/** Joins and checks that the result stays inside root. */
function safeJoin(root, name) {
  const full = path.resolve(root, ...name.split('/'));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('The extension contains an unsafe file path.');
  return full;
}

module.exports = { extensionIdFrom, crxUrl, crxToZip, readZip, safeJoin };
