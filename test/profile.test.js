'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Profile } = require('../src/core/profile');

const mk = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zb-profile-')), 'p.json');
  return { file, p: new Profile(file) };
};

test('settings persist across restarts and reset to defaults', () => {
  const { file, p } = mk();
  p.updateSettings({ theme: 'light', tabLayout: 'vertical' });
  p.flush();
  const p2 = new Profile(file);
  assert.equal(p2.settings.theme, 'light');
  assert.equal(p2.settings.tabLayout, 'vertical');
  p2.resetSettings();
  assert.equal(p2.settings.theme, 'dark');
});

test('a corrupt or hand-edited profile falls back safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-profile-'));
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({ settings: { theme: 'NEON', evil: 1 }, history: 'nope', bookmarks: 5 }));
  const p = new Profile(file);
  assert.equal(p.settings.theme, 'dark');
  assert.deepEqual(p.history, []);
  assert.deepEqual(p.bookmarks, { folders: [], bookmarks: [] });
});

test('bookmarks and folders', () => {
  const { p } = mk();
  const f = p.addFolder('Work');
  const b = p.addBookmark({ title: 'Docs', url: 'https://docs.example.com/', folderId: f.id });
  assert.equal(p.addBookmark({ title: 'Docs 2', url: 'https://docs.example.com/' }).id, b.id, 'same URL updates instead of duplicating');
  assert.equal(p.listBookmarks().bookmarks.length, 1);
  assert.throws(() => p.addBookmark({ title: 'x', url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => p.addBookmark({ title: 'x', url: 'file:///c:/x' }), /http/);
  p.removeFolder(f.id);
  assert.equal(p.listBookmarks().bookmarks[0].folderId, null);
  assert.equal(p.importBookmarks([{ title: 'A', url: 'https://a.example/', folder: 'Imp' }, { title: 'bad', url: 'ftp://x/y' }, { title: 'A', url: 'https://a.example/', folder: 'Imp' }]), 1);
  p.removeBookmark(b.id);
  assert.equal(p.listBookmarks().bookmarks.length, 1);
});

test('history: visits, search, suggestions, clearing, no non-web URLs', () => {
  const { p } = mk();
  p.addVisit('https://example.com/a', 'Example A');
  p.addVisit('https://example.com/a', 'Example A');
  p.addVisit('https://other.org/', 'Other');
  p.addVisit('zentro://settings/', 'Settings');
  p.addVisit('javascript:alert(1)', 'x');
  assert.equal(p.history.length, 2);
  assert.equal(p.listHistory({ query: 'example' }).items[0].visits, 2);
  p.addBookmark({ title: 'My other site', url: 'https://other.org/' });
  const s = p.suggest('oth');
  assert.equal(s[0].type, 'bookmark');
  assert.equal(p.recentSites(5).length, 2);
  p.clearHistory(Date.now() - 60000); // "last minute" removes recent entries
  assert.equal(p.history.length, 0);
});

test('collections', () => {
  const { p } = mk();
  const c = p.createCollection('Trip');
  p.addToCollection(c.id, { type: 'site', title: 'Hotel', url: 'https://hotel.example/' });
  p.addToCollection(c.id, { type: 'note', title: 'Todo', text: 'pack bags' });
  assert.throws(() => p.addToCollection(c.id, { type: 'site', url: 'javascript:1' }), /http/);
  assert.equal(p.listCollections()[0].items.length, 2);
  p.removeFromCollection(c.id, p.listCollections()[0].items[0].id);
  assert.equal(p.listCollections()[0].items.length, 1);
});

test('session restore data is validated', () => {
  const { file, p } = mk();
  p.setSession([{ tabs: [{ url: 'https://a.example/', title: 'A', pinned: true }, { url: 'javascript:1' }, { url: 'zentro://newtab/' }], active: 9 }]);
  p.flush();
  const w = new Profile(file).getSession().windows;
  assert.equal(w[0].tabs.length, 2);
  assert.equal(w[0].active, 1);
});

test('site permissions and Shield stats', () => {
  const { p } = mk();
  p.setSitePermission('https://a.example', 'geolocation', 'allow');
  assert.equal(p.getSitePermissions()['https://a.example'].geolocation, 'allow');
  p.setSitePermission('https://a.example', 'geolocation', null);
  assert.deepEqual(p.getSitePermissions(), {});
  assert.throws(() => p.setSitePermission('https://a.example', 'media', 'maybe'), /Invalid/);
  p.addBlocked(5); p.addBlocked(2);
  assert.equal(p.stats.blockedTotal, 7);
});
