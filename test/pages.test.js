'use strict';
// Guards against the classic "button calls a method that doesn't exist" bugs, without needing to launch Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const pages = walk(path.join(root, 'pages'));
const ipc = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
const defined = new Set([...ipc.matchAll(/def\('([^']+)'/g)].map((m) => m[1]));

test('every IPC method a page calls is implemented in the main process', () => {
  for (const f of pages.filter((p) => p.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/call\(\s*'([a-z]+[:a-z-]*)'/g)) assert.ok(defined.has(m[1]), `${path.relative(root, f)} calls unknown method ${m[1]}`);
  }
});

test('every element id a page script looks up exists in its HTML', () => {
  const pairs = { 'ui/top.js': 'ui/top.html', 'ui/side.js': 'ui/side.html', 'newtab/newtab.js': 'newtab/index.html', 'reader/reader.js': 'reader/index.html', 'error/error.js': 'error/index.html', 'login/login.js': 'login/index.html', 'ui/ai.js': 'ui/ai.html', 'update/update.js': 'update/index.html', 'ui/strip.js': 'ui/strip.html' };
  for (const [js, html] of Object.entries(pairs)) {
    const ids = new Set([...fs.readFileSync(path.join(root, 'pages', html), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const src = fs.readFileSync(path.join(root, 'pages', js), 'utf8');
    for (const m of [...src.matchAll(/\$\('#([\w-]+)'\)/g), ...src.matchAll(/getElementById\('([\w-]+)'\)/g)]) assert.ok(ids.has(m[1]), `${js} needs #${m[1]} in ${html}`);
  }
});

test('every page loads only files that exist and has a strict Content-Security-Policy', () => {
  for (const html of pages.filter((p) => p.endsWith('.html'))) {
    const src = fs.readFileSync(html, 'utf8');
    assert.match(src, /Content-Security-Policy/, `${path.relative(root, html)} has no CSP`);
    assert.doesNotMatch(src, /<script(?![^>]*\bsrc=)[^>]*>/i, `${path.relative(root, html)} has an inline script`);
    assert.doesNotMatch(src, /\son\w+="/i, `${path.relative(root, html)} has an inline event handler`);
    for (const ref of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const r = ref[1];
      if (r.startsWith('zentro://assets/')) assert.ok(fs.existsSync(path.join(root, 'pages', 'shared', r.split('/').pop())), `missing shared file ${r}`);
      else if (!r.startsWith('zentro:')) assert.ok(fs.existsSync(path.join(path.dirname(html), r)), `${path.relative(root, html)} references missing ${r}`);
    }
  }
});

test('page scripts never use innerHTML with page data or eval', () => {
  for (const f of pages.filter((p) => p.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\beval\(|new Function\(|document\.write\(/, `${path.relative(root, f)} uses eval/document.write`);
    for (const m of src.matchAll(/(\w+)\.innerHTML\s*=/g)) {
      assert.ok(/ICONS\[/.test(src.slice(m.index, m.index + 80)), `${path.relative(root, f)} sets innerHTML with something other than a static icon`);
    }
  }
});

test('the window is created with the recommended Electron security settings', () => {
  const files = ['src/main/window.js', 'src/main/tab.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  assert.ok((files.match(/contextIsolation: true/g) || []).length >= 3);
  assert.ok((files.match(/sandbox: true/g) || []).length >= 3);
  assert.ok((files.match(/nodeIntegration: false/g) || []).length >= 3);
  assert.doesNotMatch(files, /nodeIntegration: true|contextIsolation: false|sandbox: false|webSecurity: false/);
});
