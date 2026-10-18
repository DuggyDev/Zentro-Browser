'use strict';
/** Zentro School Mode: focus timer, homework, notes, grades and study sites. Everything stays on this computer. */
(() => {
  const { h, icon, call, toast, Views, fail, empty } = window.M;
  const { siteLogo } = window.Z;

  const DAY_MS = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const dec = (v) => Number(String(v).trim().replace(',', '.'));
  const STUDY = [['Wikipedia', 'https://www.wikipedia.org/'], ['Khan Academy', 'https://www.khanacademy.org/'], ['Wolfram Alpha', 'https://www.wolframalpha.com/'], ['Google Scholar', 'https://scholar.google.com/'],
    ['Quizlet', 'https://quizlet.com/'], ['Desmos', 'https://www.desmos.com/calculator'], ['Duolingo', 'https://www.duolingo.com/'], ['Google Translate', 'https://translate.google.com/']];

  Views.school = async ({ view }) => {
    let R = await call('settings:get');
    let D = await call('school:get');
    let tick = 0; let finishing = false;

    const save = async (patch, redraw = true) => {
      try { D = await call('school:set', patch); if (redraw) draw(); } catch (e) { fail(e); if (redraw) draw(); }
    };
    const section = (title, ...rows) => h('section', { class: 'section' }, [h('h2', { text: title }), h('div', { class: 'card sch-card' }, rows)]);
    const field = (props) => h('input', { type: 'text', maxlength: '120', ...props });
    const btn = (text, fn, cls = '') => h('button', { class: `btn ${cls}`.trim(), type: 'button', text, on: { click: fn } });
    const sw = (val, fn, label) => { const el = h('label', { class: 'switch' }, [h('input', { type: 'checkbox', role: 'switch', 'aria-label': label }), h('i')]); el.querySelector('input').checked = !!val; el.querySelector('input').addEventListener('change', (e) => fn(e.target.checked)); return el; };

    // ------------------------------------------------------------ mode
    function modeCard() {
      const s = R.settings.school;
      const set = async (patch) => { try { R.settings = await call('settings:set', { school: patch }); } catch (e) { fail(e); } draw(); };
      return section('School Mode',
        h('div', { class: 'set' }, [
          h('div', { class: 'tx' }, [h('b', { text: s.enabled ? 'School Mode is on' : 'School Mode is off' }),
            h('p', { text: s.enabled && s.blockDistractions ? `${s.blocklist.length} distracting sites are closed until you turn it off.` : 'Turn it on while you study. Games, social media and streaming sites stay closed.' })]),
          h('div', { class: 'ctl' }, [sw(s.enabled, (v) => set({ enabled: v }), 'School Mode')])]),
        h('div', { class: 'set' }, [
          h('div', { class: 'tx' }, [h('b', { text: 'Close distracting sites' }), h('p', { text: 'You choose which sites in Settings > School Mode.' })]),
          h('div', { class: 'ctl' }, [sw(s.blockDistractions, (v) => set({ blockDistractions: v }), 'Close distracting sites'), btn('Edit list', () => window.M.open('zentro://settings/#school'))])]));
    }

    // ------------------------------------------------------------ focus timer
    const timeEl = h('div', { class: 'sch-time', 'aria-live': 'off' });
    const modeEl = h('div', { class: 'sch-mode' });
    const ringEl = h('div', { class: 'sch-ring' }, [timeEl, modeEl]);

    function weekBars() {
      const days = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * DAY_MS); days.push([dayKey(d), d.toLocaleDateString([], { weekday: 'short' })]); }
      const max = Math.max(30, ...days.map(([k]) => D.log[k] || 0));
      return h('div', { class: 'sch-bars', role: 'img', 'aria-label': 'Focus minutes in the last 7 days' }, days.map(([k, l]) => {
        const i = h('i'); i.style.height = `${Math.round(((D.log[k] || 0) / max) * 100)}%`;
        return h('div', { class: 'sch-bar', title: `${D.log[k] || 0} min` }, [h('div', { class: 'sch-col' }, [i]), h('span', { text: l })]);
      }));
    }

    function timerCard() {
      const T = D.timer;
      const running = T.endsAt > Date.now();
      const minInput = (key, label) => {
        const el = field({ value: String(T[key]), maxlength: '3', 'aria-label': label, inputmode: 'numeric' });
        el.addEventListener('change', () => { const n = Math.round(dec(el.value)); save({ timer: { [key]: n } }); });
        return el;
      };
      const today = D.log[dayKey()] || 0;
      const total = Object.values(D.log).reduce((a, b) => a + b, 0);
      return section('Focus timer',
        h('div', { class: 'sch-timer' }, [ringEl,
          h('div', { class: 'sch-timer-side' }, [
            h('div', { class: 'sch-btns' }, running
              ? [btn('Stop', () => save({ timer: { endsAt: 0 } }), 'btn-danger')]
              : [btn(`Focus ${T.focusMin} min`, () => start('focus'), 'btn-primary'), btn(`Break ${T.breakMin} min`, () => start('break'))]),
            h('div', { class: 'sch-mins' }, [h('label', { text: 'Focus (min)' }, [minInput('focusMin', 'Focus minutes')]), h('label', { text: 'Break (min)' }, [minInput('breakMin', 'Break minutes')])]),
            h('p', { class: 'sch-note', text: `Today: ${today} min focused. All time: ${total} min.` })])]),
        weekBars());
    }
    function start(mode) { save({ timer: { mode, endsAt: Date.now() + (mode === 'focus' ? D.timer.focusMin : D.timer.breakMin) * 60000 } }); }

    function paintTimer() {
      const T = D.timer;
      const left = T.endsAt - Date.now();
      if (T.endsAt > 0 && left <= 0 && !finishing) { finish(); return; }
      timeEl.textContent = T.endsAt > 0 ? clock(left) : clock((T.mode === 'focus' ? T.focusMin : T.breakMin) * 60000);
      modeEl.textContent = T.endsAt > 0 ? (T.mode === 'focus' ? 'Focus' : 'Break') : 'Ready';
      ringEl.classList.toggle('run', T.endsAt > 0);
      ringEl.dataset.mode = T.mode;
      const total = (T.mode === 'focus' ? T.focusMin : T.breakMin) * 60000;
      ringEl.style.setProperty('--p', T.endsAt > 0 ? String(Math.min(1, Math.max(0, 1 - left / total))) : '0');
    }
    async function finish() {
      finishing = true;
      const T = D.timer;
      const patch = { timer: { endsAt: 0, mode: T.mode === 'focus' ? 'break' : 'focus' } };
      if (T.mode === 'focus') { const k = dayKey(); patch.log = { ...D.log, [k]: (D.log[k] || 0) + T.focusMin }; }
      toast(T.mode === 'focus' ? 'Focus session done. Time for a break!' : 'Break over. Ready to focus again?');
      await save(patch);
      finishing = false;
    }

    // ------------------------------------------------------------ homework
    function homeworkCard() {
      const title = field({ placeholder: 'What do you have to do?', 'aria-label': 'Homework task' });
      const subject = field({ placeholder: 'Subject', maxlength: '40', 'aria-label': 'Subject' });
      const due = h('input', { type: 'date', 'aria-label': 'Due date' });
      const add = () => {
        if (!title.value.trim()) { title.focus(); return; }
        save({ tasks: [...D.tasks, { id: uid(), title: title.value.trim(), subject: subject.value.trim(), due: due.value || '', done: false }] });
      };
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const today = dayKey();
      const tomorrow = dayKey(new Date(Date.now() + DAY_MS));
      const sorted = [...D.tasks].sort((a, b) => (a.done - b.done) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
      const open = D.tasks.filter((t) => !t.done);
      const late = open.filter((t) => t.due && t.due < today).length;
      const rows = sorted.map((t) => {
        const label = !t.due ? '' : t.due < today ? 'Overdue' : t.due === today ? 'Today' : t.due === tomorrow ? 'Tomorrow' : t.due;
        const check = h('button', { class: `sch-check${t.done ? ' on' : ''}`, type: 'button', 'aria-pressed': String(t.done), title: t.done ? 'Mark as not done' : 'Mark as done', on: { click: () => save({ tasks: D.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }) } }, [icon('check')]);
        const del = h('button', { class: 'ibtn', type: 'button', title: 'Delete', 'aria-label': 'Delete task', on: { click: () => save({ tasks: D.tasks.filter((x) => x.id !== t.id) }) } }, [icon('trash')]);
        return h('div', { class: `sch-task${t.done ? ' done' : ''}` }, [check, h('div', { class: 'sch-task-main' }, [h('b', { text: t.title }), t.subject ? h('span', { class: 'chip-s', text: t.subject }) : null]),
          label ? h('span', { class: `sch-due${label === 'Overdue' && !t.done ? ' late' : label === 'Today' && !t.done ? ' soon' : ''}`, text: label }) : null, del]);
      });
      return section('Homework',
        h('div', { class: 'sch-add' }, [title, subject, due, btn('Add', add, 'btn-primary')]),
        h('p', { class: 'sch-note', text: open.length ? `${open.length} to do${late ? `, ${late} overdue` : ''}.` : 'Nothing to do. Enjoy it!' }),
        ...(rows.length ? rows : [empty('check', 'No homework yet', 'Add your first task above.')]));
    }

    // ------------------------------------------------------------ notes
    let noteTimer = 0;
    function notesCard() {
      const add = () => save({ notes: [{ id: uid(), title: 'New note', subject: '', text: '', updated: Date.now() }, ...D.notes] });
      const cards = D.notes.map((n) => {
        const t = field({ value: n.title, maxlength: '80', 'aria-label': 'Note title' });
        const s = field({ value: n.subject, maxlength: '40', placeholder: 'Subject', 'aria-label': 'Note subject' });
        const x = h('textarea', { rows: '6', maxlength: '8000', 'aria-label': 'Note text', placeholder: 'Write your notes here\u2026' });
        x.value = n.text;
        const saveNote = () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => save({ notes: D.notes.map((o) => (o.id === n.id ? { ...o, title: t.value.trim(), subject: s.value.trim(), text: x.value, updated: Date.now() } : o)) }, false).catch(() => {}), 600); };
        for (const el of [t, s, x]) el.addEventListener('input', saveNote);
        const del = h('button', { class: 'ibtn', type: 'button', title: 'Delete note', 'aria-label': 'Delete note', on: { click: () => save({ notes: D.notes.filter((o) => o.id !== n.id) }) } }, [icon('trash')]);
        return h('div', { class: 'sch-note-card' }, [h('div', { class: 'sch-note-head' }, [t, s, del]), x]);
      });
      return section('Notes', h('div', { class: 'sch-add' }, [btn('New note', add, 'btn-primary')]), ...(cards.length ? [h('div', { class: 'sch-notes' }, cards)] : [empty('note', 'No notes yet', 'Make a note per subject. It saves by itself.')]));
    }

    // ------------------------------------------------------------ grades
    function gradesCard() {
      const subject = field({ placeholder: 'Subject', maxlength: '40', 'aria-label': 'Subject' });
      const grade = field({ placeholder: 'Grade (0-10)', maxlength: '5', 'aria-label': 'Grade', inputmode: 'decimal' });
      const weight = field({ placeholder: 'Weight', maxlength: '5', value: '1', 'aria-label': 'Weight', inputmode: 'decimal' });
      const add = () => {
        const g = dec(grade.value); const w = dec(weight.value);
        if (!(g >= 0 && g <= 10)) { toast('A grade is a number from 0 to 10.'); return; }
        if (!(w >= 0.1 && w <= 10)) { toast('A weight is a number from 0.1 to 10.'); return; }
        save({ grades: [...D.grades, { id: uid(), subject: subject.value.trim(), grade: g, weight: w }] });
      };
      const sum = D.grades.reduce((a, g) => a + g.grade * g.weight, 0);
      const wsum = D.grades.reduce((a, g) => a + g.weight, 0);
      const avg = wsum ? sum / wsum : null;
      const target = field({ placeholder: 'Goal, e.g. 7', maxlength: '5', 'aria-label': 'Goal average', inputmode: 'decimal' });
      const nextW = field({ placeholder: 'Weight of next test', maxlength: '5', value: '1', 'aria-label': 'Weight of the next test', inputmode: 'decimal' });
      const out = h('p', { class: 'sch-result', role: 'status' });
      const calc = () => {
        const t = dec(target.value); const w = dec(nextW.value);
        if (!D.grades.length) { out.textContent = 'Add at least one grade first.'; return; }
        if (!(t >= 1 && t <= 10) || !(w > 0)) { out.textContent = 'Fill in a goal (1-10) and the weight of your next test.'; return; }
        const need = (t * (wsum + w) - sum) / w;
        out.textContent = need <= 1 ? 'You already reach it, whatever you score.' : need > 10 ? `Not reachable with one test (you would need ${need.toFixed(1)}).` : `You need at least a ${need.toFixed(1)} on the next test.`;
      };
      const rows = D.grades.map((g) => h('div', { class: 'sch-grade' }, [h('b', { text: g.subject || 'Grade' }), h('span', { class: 'chip-s', text: `x${g.weight}` }), h('strong', { text: g.grade.toFixed(1) }),
        h('button', { class: 'ibtn', type: 'button', title: 'Delete', 'aria-label': 'Delete grade', on: { click: () => save({ grades: D.grades.filter((x) => x.id !== g.id) }) } }, [icon('trash')])]));
      return section('Grades',
        h('div', { class: 'sch-add' }, [subject, grade, weight, btn('Add', add, 'btn-primary')]),
        h('div', { class: 'sch-avg' }, [h('span', { text: 'Weighted average' }), h('b', { text: avg === null ? '-' : avg.toFixed(2) })]),
        ...(rows.length ? rows : [empty('grade', 'No grades yet', 'Add your grades to see your average.')]),
        h('div', { class: 'sch-add' }, [target, nextW, btn('What do I need?', calc)]), out);
    }

    // ------------------------------------------------------------ study sites
    function studyCard() {
      return section('Study sites', h('div', { class: 'sch-sites' }, STUDY.map(([name, url]) => {
        const b = h('button', { class: 'sch-site', type: 'button', title: name, on: { click: () => window.M.open(url, true) } }, [siteLogo(name, url, 40), h('span', { text: name })]);
        return b;
      })));
    }

    function draw() {
      clearInterval(tick);
      view.replaceChildren(modeCard(), timerCard(), homeworkCard(), gradesCard(), notesCard(), studyCard());
      paintTimer();
      tick = setInterval(paintTimer, 500);
    }
    draw();
    window.Z.on('settings-changed', async () => { try { R = await call('settings:get'); } catch { /* keep */ } if (document.activeElement === document.body) draw(); });
    window.addEventListener('pagehide', () => clearInterval(tick));
  };
})();
