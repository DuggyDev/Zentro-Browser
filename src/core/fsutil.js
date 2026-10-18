'use strict';
const fs = require('fs');
const path = require('path');

/** Safe single Windows file name (no folders, no reserved names, no hidden-character tricks). */
function sanitizeFileName(name, fallback = 'download') {
  let n = String(name == null ? '' : name);
  try { n = n.normalize('NFC'); } catch { /* ignore */ }
  n = n.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  n = n.split(/[\\/]/).pop().replace(/[<>:"|?*]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(n.split('.')[0])) n = '_' + n;
  if (n.length > 180) { const ext = path.extname(n).slice(0, 20); n = n.slice(0, 180 - ext.length) + ext; }
  return n || fallback;
}

/** "name.ext" -> first free "name (1).ext" in dir. The result is always inside dir. */
function uniquePathSync(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const full = path.resolve(dir, i === 0 ? name : `${base} (${i})${ext}`);
    if (path.relative(path.resolve(dir), full).startsWith('..')) throw new Error('Unsafe path');
    if (!fs.existsSync(full)) return full;
  }
  throw new Error('No free file name');
}

const DANGEROUS = new Set(['.exe', '.msi', '.msp', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.ps1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.hta', '.jar', '.lnk', '.reg', '.cpl', '.msc', '.dll', '.sys', '.application', '.scf', '.url', '.inf', '.chm']);
const isDangerousFile = (name) => DANGEROUS.has(path.extname(String(name || '')).toLowerCase());

module.exports = { sanitizeFileName, uniquePathSync, isDangerousFile };
