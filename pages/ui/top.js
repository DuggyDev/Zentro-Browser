'use strict';
(() => {
  const { h, icon, call, on, fmtBytes, hostOf, toast: pageToast } = window.Z;
  const $ = (s) => document.querySelector(s);
  const swallow = () => {};

  let S = null;           // latest window state from the main process
  let panel = null;       // which popup is open: menu | downloads | shield | bookmark | collection
  let editing = false;    // the user is typing in the address bar
  let sugItems = []; let sugSel = 0; let sugTimer = 0; let lastExtent = null;
  let dirty = false; let lastKey = '';   // dirty: the user typed something that must not be overwritten

  const address = $('#address');

  // ---------------------------------------------------------------- static icons
  const setIcon = (sel, name) => { const el = $(sel); el.prepend(icon(name)); };
  setIcon('#new-tab', 'plus'); setIcon('#back', 'back'); setIcon('#forward', 'forward'); setIcon('#home', 'home');
  setIcon('#star', 'star'); setIcon('#dl-btn', 'download'); setIcon('#ext-btn', 'puzzle'); setIcon('#menu-btn', 'menu'); setIcon('#ai-btn', 'sparkles'); setIcon('#school-btn', 'school');
  setIcon('#find-prev', 'up'); setIcon('#find-next', 'down'); setIcon('#find-close', 'close');

  // ---------------------------------------------------------------- extent: how tall the toolbar view must be right now
  function syncExtent() {
    let v = 0;
    if (panel) v = 'full';
    else {
      if (!$('#suggest').hidden) v = Math.max(v, $('#suggest').offsetHeight + 12);
      if (!$('#find-bar').hidden || !$('#prompt-bar').hidden || !$('#toast-bar').hidden) v = Math.max(v, $('#bars').offsetHeight + 8);
    }
    if (v !== lastExtent) { lastExtent = v; call('ui:extent', v).catch(swallow); }
  }

  // ---------------------------------------------------------------- render state
  let lastTabCount = -1;
  function render() {
    if (!S) return;
    if (lastTabCount >= 0 && S.tabs.length > lastTabCount) window.Z.sound('open');
    lastTabCount = S.tabs.length;
    document.documentElement.dataset.accent = S.accent;
    document.body.classList.toggle('vertical', S.layout.vertical);
    document.body.classList.toggle('private', S.isPrivate);
    if (!S.layout.vertical) window.ZTabs.render($('#tabs'), S.tabs);
    const n = S.nav;
    $('#back').disabled = !n || !n.canBack;
    $('#forward').disabled = !n || !n.canForward;
    const rl = $('#reload');
    rl.replaceChildren(icon(n && n.loading ? 'stop' : 'reload'));
    rl.title = n && n.loading ? 'Stop loading' : 'Reload (Ctrl+R)';
    rl.disabled = !n;
    document.body.classList.toggle('is-loading', !!(n && n.loading));

    if (n) {
      const key = `${S.activeId}|${n.url}`;
      if (key !== lastKey) { lastKey = key; if (!dirty) { address.value = n.display; editing = false; } }
      else if (!editing && !dirty && document.activeElement !== address) address.value = n.display;
    }
    const sec = $('#sec');
    const kind = n ? n.security : 'internal';
    sec.className = `tbtn sec-${kind}`;
    sec.replaceChildren(icon(kind === 'secure' ? 'lock' : kind === 'insecure' ? 'warn' : kind === 'internal' ? 'shield' : 'doc'));
    sec.title = { secure: 'Connection is secure (HTTPS)', insecure: 'Connection is not secure', internal: 'Zentro page', local: 'Local file' }[kind];

    const sh = S.shield;
    const sb = $('#shield-btn');
    sb.querySelector('svg')?.remove();
    sb.prepend(icon(sh && sh.active ? 'shield' : 'shield-off'));
    sb.classList.toggle('on', !!(sh && sh.active));
    sb.disabled = !sh || !sh.web;
    sb.title = sh && sh.web ? (sh.active ? 'Zentro Shield is on for this site' : 'Zentro Shield is off for this site') : 'Zentro Shield (web pages only)';
    const cnt = $('#shield-count');
    cnt.hidden = !(sh && sh.active && sh.blocked > 0);
    cnt.textContent = sh && sh.blocked > 99 ? '99+' : String(sh ? sh.blocked : 0);

    const star = $('#star');
    star.replaceChildren(icon(n && n.bookmarked ? 'star-fill' : 'star'));
    star.classList.toggle('on', !!(n && n.bookmarked));
    star.disabled = !n || !/^https?:/i.test(n.url);
    const zc = $('#zoom-chip');
    zc.hidden = !n || n.zoom === 100;
    if (n) zc.textContent = `${n.zoom}%`;

    const pb = $('#private-badge');
    pb.hidden = !S.isPrivate;
    pb.replaceChildren(icon('private'), document.createTextNode('Private'));

    const d = S.downloads;
    $('#dl-badge').hidden = d.active === 0;
    $('#dl-badge').textContent = String(d.active);
    $('#dl-progress').hidden = d.active === 0 || d.fraction == null;
    if (d.fraction != null) $('#dl-fill').style.width = `${Math.round(d.fraction * 100)}%`;

    // permission prompt
    const pr = $('#prompt-bar');
    const pChanged = (S.prompt && S.prompt.id) !== pr._id;
    pr.hidden = !S.prompt;
    pr._id = S.prompt && S.prompt.id;
    if (S.prompt && pChanged) $('#prompt-text').textContent = `${hostOf(S.prompt.origin) || S.prompt.origin} wants to ${S.prompt.label}.`;
    syncExtent();
  }

  // ---------------------------------------------------------------- address bar + suggestions
  function closeSuggest() { $('#suggest').hidden = true; sugItems = []; syncExtent(); }

  function drawSuggest() {
    const box = $('#suggest');
    box.replaceChildren(...sugItems.map((it, i) => {
      const row = h('div', { class: `sug${i === sugSel ? ' sel' : ''}`, role: 'option' }, [
        icon(it.kind === 'search' ? 'search' : it.kind === 'go' ? 'globe' : it.kind === 'bookmark' ? 'bookmark' : 'history'),
        h('div', { class: 'sug-main' }, [document.createTextNode(it.title), it.url && it.kind !== 'go' ? h('span', { class: 'sug-url', text: hostOf(it.url) }) : null]),
      ]);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      return row;
    }));
    box.hidden = sugItems.length === 0;
    syncExtent();
  }

  function choose(i) {
    const it = sugItems[i];
    closeSuggest();
    editing = false;
    dirty = false;
    call('nav:go', it && it.kind !== 'search' && it.kind !== 'go' ? it.url : address.value).catch(swallow);
    address.blur();
  }

  async function updateSuggest() {
    const text = address.value.trim();
    if (!text) { closeSuggest(); return; }
    let found = [];
    try { found = await call('suggest', text); } catch { /* none */ }
    if (address.value.trim() !== text) return; // outdated answer
    const looksLikeUrl = !/\s/.test(text) && /[./:]/.test(text);
    sugItems = [{ kind: looksLikeUrl ? 'go' : 'search', title: looksLikeUrl ? `Go to ${text}` : `Search for \u201C${text}\u201D`, url: '' },
      ...found.map((f) => ({ kind: f.type, title: f.title || f.url, url: f.url }))];
    sugSel = 0;
    drawSuggest();
  }

  address.addEventListener('focus', () => { editing = true; address.select(); });
  address.addEventListener('blur', () => { setTimeout(() => { editing = false; dirty = false; closeSuggest(); lastKey = ''; render(); }, 120); });
  window.addEventListener('blur', () => { editing = false; dirty = false; closeSuggest(); lastKey = ''; if (S && S.nav) address.value = S.nav.display; });
  address.addEventListener('input', () => { editing = true; dirty = true; clearTimeout(sugTimer); sugTimer = setTimeout(updateSuggest, 70); });
  address.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && sugItems.length) { e.preventDefault(); sugSel = (sugSel + 1) % sugItems.length; drawSuggest(); }
    else if (e.key === 'ArrowUp' && sugItems.length) { e.preventDefault(); sugSel = (sugSel - 1 + sugItems.length) % sugItems.length; drawSuggest(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugItems.length) choose(sugSel); else { editing = false; dirty = false; call('nav:go', address.value).catch(swallow); address.blur(); } }
    else if (e.key === 'Escape') { editing = false; dirty = false; closeSuggest(); if (S && S.nav) address.value = S.nav.display; address.blur(); }
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#suggest, #omni')) closeSuggest(); });

  // ---------------------------------------------------------------- toolbar buttons
  $('#new-tab').addEventListener('click', () => call('tab:new').catch(swallow));
  $('#back').addEventListener('click', () => call('nav:action', 'back').catch(swallow));
  $('#forward').addEventListener('click', () => call('nav:action', 'forward').catch(swallow));
  $('#reload').addEventListener('click', () => call('nav:action', S && S.nav && S.nav.loading ? 'stop' : 'reload').catch(swallow));
  $('#home').addEventListener('click', () => call('nav:action', 'home').catch(swallow));
  $('#sec').addEventListener('click', () => openPanel('shield'));
  $('#shield-btn').addEventListener('click', () => openPanel('shield'));
  $('#star').addEventListener('click', () => openPanel('bookmark'));
  $('#dl-btn').addEventListener('click', () => openPanel('downloads'));
  $('#ai-btn').addEventListener('click', () => call('nav:action', 'ai:toggle').catch(swallow));
  $('#me-btn').addEventListener('click', () => call('nav:open', { text: 'zentro://account/', newTab: true }).catch(swallow));
  $('#school-btn').addEventListener('click', () => call('nav:open', { text: 'zentro://school/', newTab: true }).catch(swallow));
  on('ai-state', (a) => $('#ai-btn').classList.toggle('on', !!(a && a.open)));
  async function drawMe() {
    try {
      const [r, acc] = await Promise.all([call('settings:get'), call('account:state')]);
      const a = r.settings.avatar;
      $('#ai-btn').hidden = !r.settings.ai.enabled;
      $('#school-btn').classList.toggle('on', !!r.settings.school.enabled);
      $('#school-btn').title = r.settings.school.enabled ? 'School Mode is on' : 'School Mode';
      $('#me-btn').replaceChildren(window.Z.avatarEl({ style: a.style, label: r.settings.profile.displayName || acc.name || acc.email || 'Z', size: 28, imageUrl: a.image ? `zentro://avatar/current?v=${a.rev}` : null }));
      $('#me-btn').title = acc.signedIn ? `Signed in as ${acc.email}` : 'Account and Premium';
    } catch { /* keep the old picture */ }
  }
  drawMe();
  on('settings-changed', drawMe); on('account-changed', drawMe);
  $('#ext-btn').addEventListener('click', () => call('nav:open', { text: 'zentro://extensions/', newTab: true }).catch(swallow));
  $('#menu-btn').addEventListener('click', () => openPanel('menu'));

  // ---------------------------------------------------------------- popups
  const P = $('#panel');
  function closePanel() { panel = null; P.hidden = true; $('#backdrop').hidden = true; syncExtent(); }
  $('#backdrop').addEventListener('mousedown', closePanel);

  async function openPanel(name) {
    if (panel === name) { closePanel(); return; }
    closeSuggest();
    panel = name;
    P.className = `panel${name === 'downloads' || name === 'collection' ? ' panel-wide' : ''}`;
    P.replaceChildren();
    P.hidden = false;
    $('#backdrop').hidden = false;
    syncExtent();
    try {
      if (name === 'menu') drawMenu();
      else if (name === 'downloads') await drawDownloads();
      else if (name === 'shield') drawShield();
      else if (name === 'bookmark') await drawBookmark();
      else if (name === 'collection') await drawCollection();
      else if (name === 'find') { closePanel(); openFind(); }
    } catch (err) { P.replaceChildren(h('p', { class: 'note', text: err.message })); }
  }

  const item = (label, ic, fn, hint, disabled) => {
    const b = h('button', { class: 'mi', type: 'button', disabled: disabled ? '' : null }, [icon(ic), h('span', { text: label }), hint ? h('span', { class: 'hint', text: hint }) : null]);
    b.addEventListener('click', () => { closePanel(); fn(); });
    return b;
  };
  const act = (a) => () => call('nav:action', a).catch(swallow);
  const openPage = (url) => () => call('nav:open', { text: url, newTab: true }).catch(swallow);

  function drawMenu() {
    const web = S && S.nav && S.nav.readable;
    const zoom = h('div', { class: 'zoom-row' }, [icon('zoom'), h('span', { text: 'Zoom' }),
      h('button', { class: 'btn', type: 'button', text: '\u2212', 'aria-label': 'Zoom out', on: { click: () => call('nav:action', 'zoom:out').catch(swallow) } }),
      h('b', { text: `${S && S.nav ? S.nav.zoom : 100}%`, id: 'zoom-val' }),
      h('button', { class: 'btn', type: 'button', text: '+', 'aria-label': 'Zoom in', on: { click: () => call('nav:action', 'zoom:in').catch(swallow) } })]);
    const curPos = { top: 'horizontal', left: 'vertical', right: 'right', bottom: 'bottom' }[S && S.layout ? S.layout.pos : 'top'] || 'horizontal';
    const posRow = h('div', { class: 'zoom-row' }, [icon('tab-top'), h('span', { text: 'Tabs' }),
      ...[['horizontal', 'tab-top', 'Top'], ['vertical', 'tab-left', 'Left'], ['right', 'tab-right', 'Right'], ['bottom', 'tab-bottom', 'Bottom']].map(([v, ic, l]) => h('button', {
        class: `btn pos${curPos === v ? ' on' : ''}`, type: 'button', title: `Tabs at the ${l.toLowerCase()}`, 'aria-label': `Tabs at the ${l.toLowerCase()}`,
        on: { click: (e) => { e.stopPropagation(); closePanel(); call('settings:set', { tabLayout: v }).catch(swallow); } },
      }, [icon(ic)]))]);
    P.replaceChildren(
      item('New tab', 'plus', act('tab:new'), 'Ctrl+T'), item('New window', 'window', act('window:new'), 'Ctrl+N'), item('New private window', 'private', act('window:private'), 'Ctrl+Shift+N'),
      h('div', { class: 'sep' }),
      item('Bookmarks', 'bookmark', openPage('zentro://bookmarks/')), item('History', 'history', openPage('zentro://history/'), 'Ctrl+H'),
      item('Downloads', 'download', () => openPanel('downloads'), 'Ctrl+J'), item('Collections', 'collections', openPage('zentro://collections/')),
      item('Extensions', 'puzzle', openPage('zentro://extensions/')),
      h('div', { class: 'sep' }), zoom, posRow,
      item('Find in page', 'search', () => openFind(), 'Ctrl+F'), item('Reading mode', 'reader', act('reader'), '', !web),
      item('Add page to a collection', 'collections', () => openPanel('collection'), '', !web), item('Print', 'print', act('print'), 'Ctrl+P'),
      item('Full screen', 'fullscreen', act('fullscreen'), 'F11'),
      h('div', { class: 'sep' }),
      item('School Mode', 'school', openPage('zentro://school/')), item('Chat', 'chat', openPage('zentro://chat/')),
      item('Account & Premium', 'crown', openPage('zentro://account/')),
      item('Clear browsing data', 'trash', act('clear-data'), 'Ctrl+Shift+Del'), item('Settings', 'sliders', openPage('zentro://settings/')),
    );
    P.querySelectorAll('.zoom-row .btn').forEach((b) => b.addEventListener('click', (e) => e.stopPropagation()));
  }

  async function drawDownloads() {
    const list = (await call('downloads:list')).slice(0, 7);
    const rows = list.map((d) => {
      const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0;
      const live = d.state === 'progressing' || d.state === 'paused';
      const meta = d.state === 'completed' ? fmtBytes(d.totalBytes) : live ? `${fmtBytes(d.receivedBytes)}${d.totalBytes ? ' of ' + fmtBytes(d.totalBytes) : ''}${d.state === 'paused' ? ' (paused)' : d.speed > 0 ? `, ${fmtBytes(d.speed)}/s` : ''}` : d.error || 'Canceled';
      const btn = (ic, title, fn) => h('button', { class: 'tbtn', type: 'button', title, 'aria-label': title, on: { click: (e) => { e.stopPropagation(); fn(); } } }, [icon(ic)]);
      const acts = [];
      if (live) { acts.push(btn(d.state === 'paused' ? 'play' : 'pause', d.state === 'paused' ? 'Resume' : 'Pause', () => call(d.state === 'paused' ? 'downloads:resume' : 'downloads:pause', d.id).then(refresh).catch((e) => pageToast(e.message)))); acts.push(btn('close', 'Cancel', () => call('downloads:cancel', d.id).then(refresh).catch(swallow))); }
      else if (d.state === 'completed') { acts.push(btn('external', 'Open file', () => call('downloads:open', d.id).catch((e) => pageToast(e.message)))); acts.push(btn('folder', 'Show in folder', () => call('downloads:reveal', d.id).catch(swallow))); }
      else if (d.canRetry) acts.push(btn('retry', 'Try again', () => call('downloads:retry', d.id).then(refresh).catch((e) => pageToast(e.message))));
      return h('div', { class: 'dl-item' }, [h('div', { class: 'dl-top' }, [h('div', { class: 'dl-name', text: d.fileName, title: d.fileName }), ...acts]),
        live ? h('div', { class: 'dl-bar' }, [(() => { const i = h('i'); i.style.width = `${pct}%`; return i; })()]) : null, h('div', { class: 'dl-meta', text: meta })]);
    });
    P.replaceChildren(h('h3', { text: 'Downloads' }), ...(rows.length ? rows : [h('p', { class: 'note', text: 'No downloads yet.' })]),
      h('div', { class: 'sep' }), item('See all downloads', 'download', openPage('zentro://downloads/')));
    const refresh = () => { if (panel === 'downloads') drawDownloads().catch(swallow); };
    drawDownloads.refresh = refresh;
  }

  function drawShield() {
    const s = S && S.shield;
    if (!s || !s.web) { P.replaceChildren(h('h3', { text: 'Zentro Shield' }), h('p', { class: 'note', text: 'Shield protects websites. This is a Zentro or local page, so there is nothing to block here.' })); return; }
    const sw = h('label', { class: 'switch' }, [h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Shield for this site' }), h('i')]);
    sw.querySelector('input').checked = s.active;
    sw.querySelector('input').disabled = !s.enabled;
    sw.querySelector('input').addEventListener('change', () => { call('shield:toggle-site').catch(swallow); setTimeout(() => { if (panel === 'shield') drawShield(); }, 120); });
    const line = (k, v, cls) => h('div', { class: 'stat-line' }, [h('span', { text: k }), h('b', { class: cls || '', text: v })]);
    P.replaceChildren(
      h('h3', { text: 'Zentro Shield' }),
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, [h('b', { text: s.host }), h('div', { class: 'dl-meta', text: !s.enabled ? 'Shield is off for all sites (Settings)' : s.active ? 'Protection is on for this site' : 'Protection is off for this site' })]), sw]),
      h('div', { class: 'sep' }),
      line('Ads and trackers blocked on this page', String(s.blocked), s.blocked ? 'ok' : 'off'),
      line('Tracker blocking', s.active && s.blockTrackers ? `On (${s.listSize.toLocaleString()} known domains)` : 'Off', s.active && s.blockTrackers ? 'ok' : 'off'),
      line('Third-party cookies', s.active ? s.cookies : 'allowed', s.active && s.cookies === 'blocked' ? 'ok' : 'off'),
      line('HTTPS first', s.httpsFirst ? (s.upgraded ? 'Upgraded to HTTPS' : 'On') : 'Off', s.httpsFirst ? 'ok' : 'off'),
      s.insecureFallback ? line('Connection', 'HTTPS unavailable, not encrypted', 'warn') : null,
      h('p', { class: 'note', text: 'Shield blocks requests to known ad and tracking domains. It does not hide you, and it does not block every ad or tracker.' }),
      item('Shield settings', 'sliders', openPage('zentro://settings/#shield')),
    );
  }

  async function drawBookmark() {
    let st = await call('bookmark:state');
    if (!st.web) { P.replaceChildren(h('h3', { text: 'Bookmark' }), h('p', { class: 'note', text: 'Only web pages can be bookmarked.' })); return; }
    if (!st.bookmark) { await call('bookmark:save', { title: st.title || st.url, url: st.url }); st = await call('bookmark:state'); }
    const name = h('input', { type: 'text', value: st.bookmark.title, maxlength: '300', 'aria-label': 'Name' });
    const folder = h('select', { 'aria-label': 'Folder' }, [h('option', { value: '', text: 'No folder' }), ...st.folders.map((f) => h('option', { value: f.id, text: f.name }))]);
    folder.value = st.bookmark.folderId || '';
    P.replaceChildren(h('h3', { text: 'Bookmark added' }),
      h('div', { class: 'field' }, [h('label', { text: 'Name' }), name]), h('div', { class: 'field' }, [h('label', { text: 'Folder' }), folder]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-danger', type: 'button', text: 'Remove', on: { click: () => { call('bookmark:remove-url', st.url).catch(swallow); closePanel(); } } }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Done', on: { click: () => { call('bookmark:save', { title: name.value || st.url, url: st.url, folderId: folder.value || null }).catch((e) => pageToast(e.message)); closePanel(); } } })]));
    name.focus(); name.select();
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') P.querySelector('.btn-primary').click(); });
  }

  async function drawCollection() {
    const cols = await call('collections:list');
    const add = (body) => call('collections:add-current', body).then(() => { pageToast('Added to collection.'); closePanel(); }).catch((e) => pageToast(e.message));
    const nameInput = h('input', { type: 'text', placeholder: 'New collection name', maxlength: '80', 'aria-label': 'New collection name' });
    P.replaceChildren(h('h3', { text: 'Add to collection' }),
      ...cols.map((c) => { const b = h('button', { class: 'mi', type: 'button' }, [icon('collections'), h('span', { text: c.name }), h('span', { class: 'hint', text: String(c.items.length) })]); b.addEventListener('click', () => add({ collectionId: c.id })); return b; }),
      cols.length ? h('div', { class: 'sep' }) : null,
      h('div', { class: 'field' }, [nameInput]),
      h('div', { class: 'actions' }, [h('button', { class: 'btn btn-primary', type: 'button', text: 'Create and add', on: { click: () => add({ newName: nameInput.value || 'My collection' }) } })]));
  }

  // ---------------------------------------------------------------- find bar
  const fb = $('#find-bar');
  function openFind() { fb.hidden = false; syncExtent(); $('#find-input').focus(); $('#find-input').select(); }
  function closeFind() { fb.hidden = true; call('find:stop').catch(swallow); $('#find-count').textContent = ''; syncExtent(); }
  const find = (next, forward) => call('find:start', { text: $('#find-input').value, forward, matchCase: $('#find-case').checked, next }).catch(swallow);
  $('#find-input').addEventListener('input', () => find(false, true));
  $('#find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(true, !e.shiftKey); } else if (e.key === 'Escape') closeFind(); });
  $('#find-next').addEventListener('click', () => find(true, true));
  $('#find-prev').addEventListener('click', () => find(true, false));
  $('#find-case').addEventListener('change', () => find(false, true));
  $('#find-close').addEventListener('click', closeFind);

  // ---------------------------------------------------------------- prompts, toasts, events
  $('#prompt-allow').addEventListener('click', () => S && S.prompt && call('permission:answer', { id: S.prompt.id, allow: true, remember: $('#prompt-remember').checked }).catch(swallow));
  $('#prompt-block').addEventListener('click', () => S && S.prompt && call('permission:answer', { id: S.prompt.id, allow: false, remember: $('#prompt-remember').checked }).catch(swallow));

  let toastTimer = 0;
  function showToast(message) {
    const t = $('#toast-bar');
    t.textContent = message;
    t.hidden = false;
    syncExtent();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; syncExtent(); }, 3500);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (panel) closePanel(); else if (!fb.hidden) closeFind(); } });

  on('state', (s) => { S = s; render(); });
  on('focus-address', () => { closePanel(); dirty = false; address.focus(); address.select(); });
  on('ui', ({ open }) => { if (['menu', 'downloads', 'shield', 'bookmark', 'collection'].includes(open)) openPanel(open); else if (open === 'find') openFind(); });
  on('find-result', (r) => { $('#find-count').textContent = r.total ? `${r.active} of ${r.total}` : ($('#find-input').value ? 'No matches' : ''); });
  on('toast', (t) => showToast(t.message));
  on('downloads-changed', () => { if (panel === 'downloads') drawDownloads().catch(swallow); });
  on('download-started', () => { if (!panel) openPanel('downloads'); });

  call('ui:state').then((s) => { S = s; render(); if (s.nav && s.nav.display === '') { address.focus(); } }).catch(swallow);
})();
