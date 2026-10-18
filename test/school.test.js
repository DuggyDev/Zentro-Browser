'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSchool, isBlocked, weightedAverage, neededGrade, DEFAULT_SCHOOL, clone } = require('../src/core/school');
const { sanitizeSettings, DEFAULT_SETTINGS } = require('../src/core/defaults');
const { resolveInput } = require('../src/core/urls');
const { Chat, cleanText } = require('../server/chat-logic');

test('zentro://account/, school and chat open as browser pages (not as a web search)', () => {
  for (const h of ['account', 'school', 'chat']) assert.equal(resolveInput(`zentro://${h}/`, 'google').isSearch, false);
});
test('tab position accepts top, left, right and bottom only', () => {
  for (const v of ['horizontal', 'vertical', 'right', 'bottom']) assert.equal(sanitizeSettings({ tabLayout: v }, clone(DEFAULT_SETTINGS)).tabLayout, v);
  assert.throws(() => sanitizeSettings({ tabLayout: 'diagonal' }, clone(DEFAULT_SETTINGS)));
});
test('school data is validated', () => {
  const ok = sanitizeSchool({ tasks: [{ id: 'a', title: 'Sums', due: '2026-10-20' }], grades: [{ id: 'g', subject: 'Math', grade: 7, weight: 2 }] }, clone(DEFAULT_SCHOOL));
  assert.equal(ok.tasks[0].done, false);
  assert.throws(() => sanitizeSchool({ tasks: [{ id: 'a', title: '' }] }));
  assert.throws(() => sanitizeSchool({ grades: [{ id: 'g', grade: 11, weight: 1 }] }));
  assert.throws(() => sanitizeSchool({ evil: 1 }));
  assert.throws(() => sanitizeSchool({ tasks: [{ id: 'a', title: 'x', due: 'tomorrow' }] }));
});
test('School Mode blocks a site and its subdomains, nothing else', () => {
  assert.ok(isBlocked('https://www.tiktok.com/a', ['tiktok.com']));
  assert.ok(!isBlocked('https://nottiktok.com/', ['tiktok.com']));
  assert.ok(!isBlocked('zentro://school/', ['tiktok.com']));
});
test('grade maths', () => {
  const g = [{ grade: 6, weight: 1 }, { grade: 8, weight: 2 }];
  assert.ok(Math.abs(weightedAverage(g) - 22 / 3) < 1e-9);
  assert.ok(Math.abs(neededGrade(g, 7, 2) - 6.5) < 1e-9);
});
test('chat removes links, limits speed and keeps rooms apart', () => {
  assert.equal(cleanText('see https://x.com now'), 'see [link removed] now');
  const c = new Chat(); const who = { uid: 'u' };
  assert.ok(c.add('general', who, 'A', 'hi', 5000).ok);
  assert.equal(c.add('general', who, 'A', 'again', 5100).reason, 'slow');
  assert.equal(c.add('nope', who, 'A', 'x', 9000).reason, 'room');
  assert.equal(c.since('school', 0, c.epoch).messages.length, 0);
});
