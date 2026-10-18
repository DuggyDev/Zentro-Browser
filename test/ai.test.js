'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { providerList, currentProvider, clampRect, defaultRect, buildPrompt, SIZES, PROVIDERS } = require('../src/core/ai');
const { sanitizeSettings, DEFAULT_SETTINGS, clone } = require('../src/core/defaults');
const { Avatar } = require('../src/main/avatar');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('AI providers: the four built-in ones, plus your own https link', () => {
  assert.deepEqual(providerList({}).map((p) => p.id), ['chatgpt', 'claude', 'gemini', 'grok']);
  for (const p of Object.values(PROVIDERS)) assert.match(p.url, /^https:\/\//);
  const withCustom = providerList({ customName: 'Mistral', customUrl: 'https://chat.mistral.ai/' });
  assert.equal(withCustom.at(-1).name, 'Mistral');
  assert.equal(providerList({ customUrl: 'http://insecure.example/' }).length, 4);
  assert.equal(currentProvider({ provider: 'claude' }).id, 'claude');
  assert.equal(currentProvider({ provider: 'nope' }).id, 'chatgpt');
});

test('floating panel always stays inside the window', () => {
  const r = clampRect({ x: -500, y: 9999, w: 9999, h: 50 }, 1000, 700, 88);
  assert.ok(r.x >= 0 && r.y >= 88 && r.x + r.w <= 1000 && r.y + r.h <= 700);
  const d = defaultRect('m', 1280, 800, 88);
  assert.equal(d.w, SIZES.m.w);
  assert.ok(d.x + d.w <= 1280 && d.y + d.h <= 800);
  const tiny = clampRect({ x: 0, y: 0, w: 430, h: 660 }, 720, 480, 88);
  assert.ok(tiny.x + tiny.w <= 720 && tiny.y + tiny.h <= 480);
});

test('shared text is clipped and labelled', () => {
  const p = buildPrompt({ kind: 'page', title: 'T', url: 'https://a.example/', text: 'x'.repeat(50000) });
  assert.ok(p.length < 21000);
  assert.match(p, /^Page: T\nAddress: https:\/\/a\.example\//);
  assert.match(buildPrompt({ kind: 'selection', selection: 'hello' }), /Selected text:/);
});

test('settings: AI, profile picture and animations are validated', () => {
  const cur = clone(DEFAULT_SETTINGS);
  const ok = sanitizeSettings({ ai: { provider: 'claude', customUrl: 'https://x.example/', customName: 'X' }, avatar: { style: 'orbit', rev: 3 }, animations: false }, cur);
  assert.equal(ok.ai.provider, 'claude'); assert.equal(ok.avatar.style, 'orbit'); assert.equal(ok.animations, false);
  assert.throws(() => sanitizeSettings({ ai: { customUrl: 'http://x.example/' } }, cur), /https/);
  assert.throws(() => sanitizeSettings({ ai: { customUrl: 'javascript:alert(1)' } }, cur));
  assert.throws(() => sanitizeSettings({ ai: { provider: 'evil' } }, cur));
  assert.throws(() => sanitizeSettings({ avatar: { style: '<script>' } }, cur));
  assert.throws(() => sanitizeSettings({ avatar: { rev: -1 } }, cur));
  assert.throws(() => sanitizeSettings({ animations: 'yes' }, cur));
});

test('profile picture: only real PNG/JPG/WEBP/GIF files are kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zav-'));
  const av = new Avatar(dir);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
  av.set(gif);
  assert.match(av.file(), /avatar\.gif$/);
  av.set(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]));
  assert.match(av.file(), /avatar\.png$/);
  assert.equal(fs.readdirSync(dir).length, 1);           // the old one is replaced, not piled up
  assert.throws(() => av.set(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), /PNG, JPG/);
  assert.throws(() => av.set(Buffer.from('MZ\x90\x00 this is an exe'.padEnd(40, ' '))), /PNG, JPG/);
  assert.throws(() => av.set(Buffer.alloc(9 * 1024 * 1024)), /8 MB/);
  av.clear();
  assert.equal(av.file(), null);
});

test('AI panel header can only be driven by the header itself', () => {
  const ipc = read('src', 'main', 'ipc.js');
  assert.match(ipc, /h\.scope === 'ai' && info\.role !== 'ai'/);
  for (const m of read('pages', 'ui', 'ai.js').matchAll(/call\(\s*'(ai:[a-z]+)'/g)) assert.match(ipc, new RegExp(`def\\('${m[1]}', '(ai|any)'`), `${m[1]} must exist`);
  // the AI websites get no preload script, so they can never call into the browser
  const ai = read('src', 'main', 'ai.js');
  assert.match(ai, /withPreload \? \{ preload: PRELOAD \} : \{\}/);
  assert.match(ai, /role: 'aisite'|register\(wc, \{ window: this\.win, role \}\)/);
});

test('motion can be switched off', () => {
  const base = read('pages', 'shared', 'base.css');
  assert.match(base, /html\[data-anim="off"\]/);
  assert.match(base, /prefers-reduced-motion: reduce/);
  assert.match(read('pages', 'shared', 'common.js'), /dataset\.anim/);
});
