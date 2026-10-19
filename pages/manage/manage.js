'use strict';
/** Shell for the browser's own pages: navigation, shared helpers and the view registry. */
(() => {
  const { h, icon, call, toast } = window.Z;
  const Views = {};
  const TITLES = { account: 'Account & Premium', school: 'School Mode', chat: 'Chat', settings: 'Settings', bookmarks: 'Bookmarks', history: 'History', downloads: 'Downloads', collections: 'Collections', extensions: 'Extensions' };
  const ICONS = { account: 'crown', school: 'school', chat: 'chat', settings: 'sliders', bookmarks: 'bookmark', history: 'history', downloads: 'download', collections: 'collections', extensions: 'puzzle' };
  const fail = (err) => toast(err && err.message ? err.message : 'Something went wrong.');

  /** Small modal form. Resolves with the values, or null when cancelled. */
  function form({ title, text, fields = [], ok = 'Save', danger = false }) {
    return new Promise((resolve) => {
      const inputs = fields.map((f) => {
        const el = f.type === 'textarea' ? h('textarea', { rows: '4', maxlength: String(f.max || 5000) }) : f.type === 'select'
          ? h('select', {}, f.options.map(([v, l]) => h('option', { value: v, text: l }))) : h('input', { type: 'text', maxlength: String(f.max || 300), placeholder: f.placeholder || '' });
        el.value = f.value || '';
        return [f, el];
      });
      const done = (v) => { overlay.remove(); resolve(v); };
      const okBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: ok });
      const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-label': title }, [
        h('h2', { text: title }), text ? h('p', { text }) : null,
        ...inputs.map(([f, el]) => h('label', { text: f.label }, [el])),
        h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => done(null) } }), okBtn]),
      ]);
      const overlay = h('div', { class: 'modal' }, [dlg]);
      const submit = () => done(Object.fromEntries(inputs.map(([f, el]) => [f.name, el.value.trim()])));
      okBtn.addEventListener('click', submit);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(null); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); } });
      document.body.append(overlay);
      (inputs[0] ? inputs[0][1] : okBtn).focus();
    });
  }

  function empty(ic, title, text) { return h('div', { class: 'empty' }, [icon(ic), h('b', { text: title }), h('span', { text })]); }
  function ibtn(ic, label, fn, cls = '') {
    return h('button', { class: `ibtn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label, on: { click: (e) => { e.stopPropagation(); fn(e); } } }, [icon(ic)]);
  }
  const open = (url, newTab) => call('nav:open', { text: url, newTab: !!newTab }).catch(fail);

  const params = new URLSearchParams(location.search);
  const page = TITLES[location.hostname] ? location.hostname : 'settings';

  function start() {
    if (params.get('panel') === '1') document.body.classList.add('panel');
    document.title = `${TITLES[page]} - Zentro`;
    document.querySelectorAll('.nav a').forEach((a) => {
      const p = a.dataset.page;
      a.replaceChildren(icon(ICONS[p]), document.createTextNode(TITLES[p]));
      if (p === page) a.setAttribute('aria-current', 'page');
    });
    document.getElementById('title').textContent = TITLES[page];
    const brand = document.getElementById('brand');
    const toAccount = () => { if (page !== 'account') location.href = 'zentro://account/'; };
    brand.addEventListener('click', toAccount);
    brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toAccount(); } });
    Views[page]({ view: document.getElementById('view'), actions: document.getElementById('head-actions') });
  }

  window.M = { h, icon, call, toast, Views, form, empty, ibtn, open, fail, start };
})();
