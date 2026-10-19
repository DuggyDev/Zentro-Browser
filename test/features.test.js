'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_SETTINGS, sanitizeSettings, clone } = require('../src/core/defaults');
const { sniffImage } = require('../src/core/images');
const { pickIcon } = require('../src/core/favicons-core');
const compat = require('../src/main/compat');
const { Wallpapers } = require('../src/main/wallpapers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

test('new settings: dark mode for websites and selected background', () => {
  const cur = clone(DEFAULT_SETTINGS);
  assert.equal(cur.forceDark, true);
  assert.equal(sanitizeSettings({ forceDark: false }, cur).forceDark, false);
  assert.throws(() => sanitizeSettings({ forceDark: 'yes' }, cur), /Invalid/);
  const n = sanitizeSettings({ newtab: { background: 'custom', wallpaper: 'abcdef012345' } }, cur);
  assert.equal(n.newtab.wallpaper, 'abcdef012345');
  assert.equal(sanitizeSettings({ newtab: { wallpaper: null } }, n).newtab.wallpaper, null);
  for (const bad of ['../../etc/passwd', 'ABCDEF012345', 'abc', 42]) assert.throws(() => sanitizeSettings({ newtab: { wallpaper: bad } }, cur), /Invalid/, String(bad));
});

test('images are recognised by content, not by name', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])), 'webp');
  assert.equal(sniffImage(Buffer.from('MZ\x90\x00this is an exe renamed to .png, definitely not an image')), null);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>   ')), null, 'svg is refused unless explicitly allowed');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>   '), { svg: true }), 'svg');
  assert.equal(sniffImage(Buffer.from('<html><body>hi</body></html>      '), { svg: true }), null);
});

test('site icon selection prefers the big apple-touch-icon and ignores unsafe links', () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png">
    <link rel="mask-icon" href="/safari.svg">
    <link rel="icon" href="http://insecure.example/x.png" sizes="512x512">
    <link rel="icon" href="javascript:alert(1)" sizes="512x512"></head>`;
  assert.equal(pickIcon(html, 'https://site.example/'), 'https://site.example/apple-180.png');
  assert.equal(pickIcon('<link rel=icon href=/a.png sizes=32x32><link rel=icon href=/b.png sizes=64x64>', 'https://s.example/x/'), 'https://s.example/b.png');
  assert.equal(pickIcon('<p>no icons</p>', 'https://s.example/'), null);
});

test('Google sign-in pages get a Firefox identity and no Chromium client hints; nothing else is touched', () => {
  const h = { 'User-Agent': compat.CHROME_UA, 'sec-ch-ua': '"Chromium";v="140"', 'Sec-CH-UA-Mobile': '?0', Accept: '*/*' };
  const fixed = compat.googleAuthHeaders('https://accounts.google.com/v3/signin', h);
  assert.equal(fixed['User-Agent'], compat.FIREFOX_UA);
  assert.deepEqual(Object.keys(fixed).filter((k) => /^sec-ch-ua/i.test(k)), []);
  assert.equal(fixed.Accept, '*/*');
  assert.equal(compat.googleAuthHeaders('https://www.google.com/search?q=x', h), null);
  assert.equal(compat.googleAuthHeaders('https://accounts.google.com.evil.example/', h), null);
  assert.equal(compat.isGoogleAuth('not a url'), false);
  assert.ok(!/Electron/i.test(compat.CHROME_UA) && /Chrome\//.test(compat.CHROME_UA)); // (inside Electron the version number is filled in)
});

test('wallpapers: validated by file signature, limited in size and number, removable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-wp-'));
  const w = new Wallpapers(path.join(dir, 'w'));
  const id = w.addBuffer(PNG);
  assert.match(id, /^[a-f0-9]{12}$/);
  assert.ok(w.file(id).endsWith(`${id}.png`));
  assert.equal(w.file('../../x'), null);
  assert.equal(w.file('ffffffffffff'), null);
  assert.throws(() => w.addBuffer(Buffer.from('MZ not an image at all, just text pretending to be one')), /PNG, JPG or WEBP/);
  assert.throws(() => w.addBuffer(Buffer.alloc(16 * 1024 * 1024, 1)), /15 MB/);
  const f = path.join(dir, 'pic.jpg'); fs.writeFileSync(f, JPG);
  assert.ok(w.addFile(f));
  assert.equal(w.list().length, 2);
  for (let i = 0; i < 10; i++) w.addBuffer(PNG);
  assert.throws(() => w.addBuffer(PNG), /up to 12/);
  w.remove(id);
  assert.equal(w.file(id), null);
  assert.equal(w.list().length, 11);
});
