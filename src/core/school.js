'use strict';
/** Zentro School Mode: homework, notes, grades, focus timer and the distraction blocklist. Pure, no Electron. */

class SchoolError extends Error {
  constructor(m) { super(m); this.expose = true; }
}

const LIMITS = Object.freeze({ tasks: 200, notes: 100, grades: 200, logDays: 90 });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const DEFAULT_SCHOOL = Object.freeze({
  tasks: [],
  notes: [],
  grades: [],
  timer: { mode: 'focus', endsAt: 0, focusMin: 25, breakMin: 5 },
  log: {},
});

const clone = (v) => JSON.parse(JSON.stringify(v));

function text(v, max, label, { allowEmpty = true } = {}) {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new SchoolError(`Invalid ${label}.`);
  const t = v.trim();
  if (!allowEmpty && !t) throw new SchoolError(`Invalid ${label}.`);
  return t;
}
function id(v) { if (typeof v !== 'string' || !ID_RE.test(v)) throw new SchoolError('Invalid item.'); return v; }
function num(v, min, max, label) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new SchoolError(`Invalid ${label}.`); return v; }

function list(v, max, label, fn) {
  if (!Array.isArray(v) || v.length > max) throw new SchoolError(`Too many ${label}.`);
  const seen = new Set();
  return v.map((x) => {
    if (!isObj(x)) throw new SchoolError(`Invalid ${label}.`);
    const item = fn(x);
    if (seen.has(item.id)) throw new SchoolError(`Invalid ${label}.`);
    seen.add(item.id);
    return item;
  });
}

const task = (x) => ({
  id: id(x.id), title: text(x.title, 120, 'task', { allowEmpty: false }), subject: text(x.subject || '', 40, 'subject'),
  due: x.due ? (DAY_RE.test(x.due) ? x.due : (() => { throw new SchoolError('Invalid date.'); })()) : '', done: x.done === true,
});
const note = (x) => ({ id: id(x.id), title: text(x.title || '', 80, 'title'), subject: text(x.subject || '', 40, 'subject'), text: text(x.text || '', 8000, 'note'), updated: num(Number(x.updated) || 0, 0, 4e12, 'date') });
const grade = (x) => ({ id: id(x.id), subject: text(x.subject || '', 40, 'subject'), grade: num(x.grade, 0, 10, 'grade'), weight: num(x.weight, 0.1, 10, 'weight') });

function timer(v, cur) {
  if (!isObj(v)) throw new SchoolError('Invalid timer.');
  const out = { ...cur };
  for (const [k, x] of Object.entries(v)) {
    if (k === 'mode') { if (x !== 'focus' && x !== 'break') throw new SchoolError('Invalid timer.'); out.mode = x; }
    else if (k === 'endsAt') out.endsAt = num(x, 0, 4e12, 'timer');
    else if (k === 'focusMin' || k === 'breakMin') { if (!Number.isInteger(x) || x < 1 || x > 180) throw new SchoolError('Timer minutes must be 1 to 180.'); out[k] = x; }
    else throw new SchoolError('Unknown timer setting.');
  }
  return out;
}

function logs(v) {
  if (!isObj(v)) throw new SchoolError('Invalid log.');
  const days = Object.keys(v).filter((d) => DAY_RE.test(d)).sort().slice(-LIMITS.logDays);
  return Object.fromEntries(days.map((d) => [d, num(v[d], 0, 1440, 'minutes')]));
}

/** Returns a new, valid school object = current + patch. Throws SchoolError on anything odd. */
function sanitizeSchool(patch, current = DEFAULT_SCHOOL) {
  if (!isObj(patch)) throw new SchoolError('Invalid request.');
  const out = clone(current);
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'tasks') out.tasks = list(v, LIMITS.tasks, 'tasks', task);
    else if (k === 'notes') out.notes = list(v, LIMITS.notes, 'notes', note);
    else if (k === 'grades') out.grades = list(v, LIMITS.grades, 'grades', grade);
    else if (k === 'timer') out.timer = timer(v, out.timer);
    else if (k === 'log') out.log = logs(v);
    else throw new SchoolError('Unknown School Mode data.');
  }
  return out;
}

/** True when the address belongs to a blocked site (the site itself or any subdomain). */
function isBlocked(url, blocklist) {
  let host;
  try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return false; host = u.hostname.toLowerCase(); } catch { return false; }
  return (blocklist || []).some((d) => host === d || host.endsWith(`.${d}`));
}

/** Weighted average of grades (0-10). null when there is nothing to average. */
function weightedAverage(grades) {
  const w = grades.reduce((a, g) => a + g.weight, 0);
  if (!w) return null;
  return grades.reduce((a, g) => a + g.grade * g.weight, 0) / w;
}

/** The grade needed on the next test (given its weight) to reach `target` overall. May be above 10 (= not reachable). */
function neededGrade(grades, target, weight) {
  const w = grades.reduce((a, g) => a + g.weight, 0);
  const sum = grades.reduce((a, g) => a + g.grade * g.weight, 0);
  if (!(weight > 0)) return null;
  return (target * (w + weight) - sum) / weight;
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

module.exports = { SchoolError, LIMITS, DEFAULT_SCHOOL, sanitizeSchool, isBlocked, weightedAverage, neededGrade, dayKey, clone };
