'use strict';
/** Keeps School Mode data (homework, notes, grades, timer) in its own file and answers "is this site blocked right now?". */
const path = require('path');
const { JsonStore } = require('../core/store');
const { DEFAULT_SCHOOL, sanitizeSchool, isBlocked, clone } = require('../core/school');

class School {
  constructor(app) {
    this.app = app;
    this.store = new JsonStore(path.join(app.userData, 'zentro-school.json'));
    this.store.load();
    let data;
    try { data = sanitizeSchool(this.store.data, clone(DEFAULT_SCHOOL)); } catch { data = clone(DEFAULT_SCHOOL); }
    this.data = data;
    this.timer = null;
  }
  get() { return this.data; }
  set(patch) {
    this.data = sanitizeSchool(patch, this.data);
    this.store.data = this.data;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 800);
    if (this.timer.unref) this.timer.unref();
    return this.data;
  }
  flush() { clearTimeout(this.timer); this.store.data = this.data; this.store.flush(); }
  /** Main-frame requests only. Private windows are not exempt: School Mode is about the person, not the window. */
  blocks(url) {
    const s = this.app.profile.settings.school;
    return !!(s && s.enabled && s.blockDistractions && isBlocked(url, s.blocklist));
  }
}

module.exports = { School };
