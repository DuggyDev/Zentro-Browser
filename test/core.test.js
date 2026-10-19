'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const u = require('../src/core/urls');
const { Blocklist } = require('../src/core/shield-core');
const { exportNetscape, importNetscape } = require('../src/core/bookmarks-io');
const { DEFAULT_SETTINGS, sanitizeSettings, clone } = require('../src/core/defaults');
const { actionFor } = require('../src/core/shortcuts');
const fsu = require('../src/core/fsutil');

test('address bar: URLs, hosts and searches', () => {
  const r = (t, e) => u.resolveInput(t, e);
  assert.equal(r('https://example.com/a?b=1').url, 'https://example.com/a?b=1');
  assert.equal(r('example.com').url, 'https://example.com/');
  assert.equal(r('example.com/path').url, 'https://example.com/path');
  assert.equal(r('sub.example.co.uk').url, 'https://sub.example.co.uk/');
  assert.equal(r('localhost:3000').url, 'http://localhost:3000/');
  assert.equal(r('192.168.1.1').url, 'http://192.168.1.1/');
  assert.equal(r('127.0.0.1:8080/x').url, 'http://127.0.0.1:8080/x');
  assert.equal(r('about:blank').url, 'about:blank');
  assert.equal(r('zentro://settings').url, 'zentro://settings');
  assert.deepEqual(r('hello world', 'duckduckgo'), { url: 'https://duckduckgo.com/?q=hello%20world', isSearch: true });
  assert.ok(r('cats').isSearch && r('cats').url.startsWith('https://www.google.com/search?q=cats'));
  assert.ok(r('hello.world').isSearch, 'unknown TLD without a path is a search');
  assert.ok(!r('hello.world/page').isSearch, 'a path makes it a URL');
  assert.equal(r('what is 1+1?').url, 'https://www.google.com/search?q=what%20is%201%2B1%3F');
  // dangerous schemes are never navigated to, they become searches
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'view-source:https://x.com', 'chrome://gpu', 'zentro://nope', 'mailto:a@b.nl']) {
    assert.ok(r(bad).isSearch, bad);
  }
  assert.equal(r('   '), null);
  assert.equal(r(''), null);
});

test('site helpers', () => {
  assert.equal(u.registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(u.registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(u.registrableDomain('user.github.io'), 'user.github.io');
  assert.equal(u.registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.ok(u.isThirdParty('cdn.tracker.net', 'news.example.com'));
  assert.ok(!u.isThirdParty('static.example.com', 'www.example.com'));
  assert.ok(u.isLocalHost('localhost') && u.isLocalHost('10.0.0.5') && u.isLocalHost('printer.local') && !u.isLocalHost('example.com') && !u.isLocalHost('8.8.8.8'));
  assert.equal(u.displayUrl('zentro://newtab/'), '');
  assert.equal(u.displayUrl('zentro://history/'), 'zentro://history');
  assert.equal(u.displayUrl('zentro://error/?url=https%3A%2F%2Fa.b%2F&code=-105'), 'https://a.b/');
  assert.equal(u.displayUrl('https://example.com/x'), 'https://example.com/x');
});

test('Shield blocklist parsing and matching', () => {
  const b = new Blocklist();
  const n = b.addText('# comment\n0.0.0.0 ads.example.com\n127.0.0.1 localhost\ntracker.net # inline\n! bang\nnot a domain\n\nEVIL.org\n');
  assert.equal(n, 3);
  assert.ok(b.matches('ads.example.com') && b.matches('x.y.ads.example.com') && b.matches('tracker.net') && b.matches('cdn.tracker.net') && b.matches('evil.org'));
  assert.ok(!b.matches('example.com') && !b.matches('notads.example.com') && !b.matches('org') && !b.matches(''));
  const bundled = new Blocklist();
  bundled.addText(fs.readFileSync(path.join(__dirname, '..', 'data', 'trackers.txt'), 'utf8'));
  assert.ok(bundled.size > 100);
  assert.ok(bundled.matches('stats.g.doubleclick.net') && bundled.matches('www.google-analytics.com'));
  for (const safe of ['www.google.com', 'github.com', 'www.wikipedia.org', 'www.youtube.com', 'example.com']) assert.ok(!bundled.matches(safe), `${safe} must not be blocked`);
});

test('bookmark export then import round-trips; unsafe links are dropped', () => {
  const folders = [{ id: 'f1', name: 'News & "Stuff"' }];
  const bookmarks = [
    { id: 'a', title: 'A <b>', url: 'https://a.example/?x=1&y=2', folderId: 'f1', addedAt: 1700000000000 },
    { id: 'b', title: 'B', url: 'https://b.example/', folderId: null, addedAt: 1700000000000 },
  ];
  const html = exportNetscape({ folders, bookmarks });
  const back = importNetscape(html).bookmarks;
  assert.deepEqual(back.map((x) => [x.title, x.url, x.folder]), [['A <b>', 'https://a.example/?x=1&y=2', 'News & "Stuff"'], ['B', 'https://b.example/', null]]);
  const evil = importNetscape('<DL><p><DT><A HREF="javascript:alert(1)">x</A><DT><A HREF="file:///c:/x">y</A><DT><A HREF="https://ok.example/">ok</A></DL>').bookmarks;
  assert.deepEqual(evil.map((x) => x.url), ['https://ok.example/']);
  const nested = importNetscape('<DL><DT><H3>Bar</H3><DL><DT><H3>Sub</H3><DL><DT><A HREF="https://n.example/">n</A></DL><DT><A HREF="https://m.example/">m</A></DL></DL>').bookmarks;
  assert.deepEqual(nested.map((x) => x.folder), ['Bar / Sub', 'Bar']);
});

test('settings validation accepts good patches and rejects bad ones', () => {
  const cur = clone(DEFAULT_SETTINGS);
  const next = sanitizeSettings({ theme: 'light', shield: { thirdPartyCookies: 'block' }, sleep: { enabled: true, minutes: 15 }, sidebar: { mode: 'expanded' } }, cur);
  assert.equal(next.theme, 'light');
  assert.equal(next.shield.thirdPartyCookies, 'block');
  assert.equal(next.shield.httpsFirst, true, 'untouched values stay');
  assert.equal(cur.theme, 'dark', 'input is not mutated');
  for (const bad of [
    { theme: 'neon' }, { evil: 1 }, { searchEngine: 'nope' }, { homepage: 'javascript:alert(1)' }, { homepage: 'file:///c:/' },
    { shield: { siteOff: ['bad host!'] } }, { shield: { evil: true } }, { sleep: { minutes: 2 } }, { downloadDir: 'relative' },
    { newtab: { speedDial: [{ id: 'x', title: 'x', url: 'javascript:1' }] } },
    { sidebar: { items: [{ id: 'z', name: 'z', url: 'zentro://settings/', mode: 'panel', builtin: false }] } },
    null, [], 'x',
  ]) assert.throws(() => sanitizeSettings(bad, cur), /Invalid|must be|Unknown|Choose|Too many/, JSON.stringify(bad));
  const withSite = sanitizeSettings({ sidebar: { items: [...cur.sidebar.items, { id: 'chat', name: 'Chat', url: 'https://chat.example.com/', mode: 'panel', builtin: false }] } }, cur);
  assert.equal(withSite.sidebar.items.length, cur.sidebar.items.length + 1);
  assert.equal(sanitizeSettings({ homepage: 'https://start.example/' }, cur).homepage, 'https://start.example/');
});

test('keyboard shortcuts', () => {
  const k = (key, mods = {}) => actionFor({ key, ...mods });
  assert.equal(k('t', { control: true }), 'tab:new');
  assert.equal(k('T', { control: true, shift: true }), 'tab:reopen');
  assert.equal(k('w', { control: true }), 'tab:close');
  assert.equal(k('l', { control: true }), 'focus-address');
  assert.equal(k('Tab', { control: true }), 'tab:next');
  assert.equal(k('Tab', { control: true, shift: true }), 'tab:prev');
  assert.equal(k('r', { control: true }), 'reload');
  assert.equal(k('F5'), 'reload');
  assert.equal(k('f', { control: true }), 'find');
  assert.equal(k('d', { control: true }), 'bookmark');
  assert.equal(k('3', { control: true }), 'tab:index:3');
  assert.equal(k('9', { control: true }), 'tab:last');
  assert.equal(k('ArrowLeft', { alt: true }), 'back');
  assert.equal(k('2', { control: true, alt: true }), 'sidebar:2');
  assert.equal(k('=', { control: true }), 'zoom:in');
  assert.equal(k('N', { control: true, shift: true }), 'window:private');
  assert.equal(k('a'), null);
  assert.equal(k('t'), null);
  assert.equal(k('Escape'), null);
});

test('file helpers', () => {
  assert.equal(fsu.sanitizeFileName('../../evil.exe'), 'evil.exe');
  assert.equal(fsu.sanitizeFileName('CON.txt'), '_CON.txt');
  assert.equal(fsu.sanitizeFileName('a\u202Egnp.exe'), 'agnp.exe');
  assert.ok(fsu.isDangerousFile('x.EXE') && !fsu.isDangerousFile('x.pdf'));
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'zb-'));
  fs.writeFileSync(path.join(dir, 'f.txt'), '');
  assert.equal(path.basename(fsu.uniquePathSync(dir, 'f.txt')), 'f (1).txt');
});
