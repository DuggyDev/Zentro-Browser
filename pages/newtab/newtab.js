'use strict';
(() => {
  const { h, icon, call, on, hostOf, avatar, toast } = window.Z;
  const $ = (s) => document.querySelector(s);
  const swallow = () => {};
  let settings = null; let engines = {};

  document.querySelectorAll('svg.icon[id]').forEach((s) => { s.setAttribute('viewBox', '0 0 24 24'); });
  const put = (sel, name) => { const el = $(sel); el.replaceChildren(...icon(name).childNodes); };
  $('#logo-edit').append(icon('edit')); $('#logo-reset').append(icon('close')); put('#search-icon', 'search'); put('#stats-icon', 'shield'); put('#cust-icon', 'sliders');
  for (const [id, ic] of [['bookmarks', 'bookmark'], ['downloads', 'download'], ['history', 'history'], ['settings', 'sliders']]) {
    const svg = $(`#ql-${id} svg`); svg.setAttribute('viewBox', '0 0 24 24'); svg.append(...icon(ic).childNodes);
  }

  // ------------------------------------------------------------ clock
  function tick() {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick();
  setInterval(tick, 10000);

  // ------------------------------------------------------------ search
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#q').value.trim()) call('nav:open', { text: $('#q').value }).catch((err) => toast(err.message));
  });
  document.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => call('nav:open', { text: b.dataset.go }).catch(swallow)));

  // ------------------------------------------------------------ logos
  /** Shows the site's own icon (downloaded by the browser from the site itself); falls back to a letter tile. */
  function logo(title, url, size) {
    const wrap = h('div', { class: 'logo-tile' }, [avatar(title, url, size)]);
    wrap.style.width = wrap.style.height = `${size}px`;
    let host = '';
    try { host = new URL(url).hostname; } catch { return wrap; }
    const img = new Image();
    img.alt = '';
    img.addEventListener('load', () => { wrap.replaceChildren(img); wrap.classList.add('has-logo'); });
    img.src = `zentro://favicon/${encodeURIComponent(host)}`;
    return wrap;
  }

  // ------------------------------------------------------------ video background (your own MP4, played as it is: no re-encoding)
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setVideo(id) {
    const v = document.getElementById('bgvideo');
    const shade = document.getElementById('bgshade');
    if (!id) {
      v.pause(); v.removeAttribute('src'); v.load(); delete v.dataset.id;
      v.hidden = true; shade.hidden = true;
      document.body.classList.remove('has-video');
      return;
    }
    v.hidden = false; shade.hidden = false;
    document.body.classList.add('has-video');
    if (v.dataset.id === id) return;
    v.dataset.id = id; v.muted = true; v.loop = true;
    v.onerror = () => { if (v.dataset.id === id) { setVideo(null); toast('That video cannot be played. Try an MP4 (H.264).'); } };
    v.src = `zentro://wallpaper/${id}`;
    if (!reduceMotion) v.play().catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {   // a hidden tab does not need to decode video
    const v = document.getElementById('bgvideo');
    if (!v || reduceMotion) return;
    if (document.hidden) v.pause(); else v.play().catch(() => {});
  });

  // ------------------------------------------------------------ speed dial
  const go = (url, newTab) => call('nav:open', { text: url, newTab }).catch((err) => toast(err.message));
  const saveDial = (list) => call('settings:set', { newtab: { speedDial: list } }).catch((err) => toast(err.message));

  function renderDial() {
    const list = settings.newtab.speedDial;
    const tiles = list.map((t) => {
      const el = h('div', { class: 'tile', role: 'link', tabindex: '0', title: t.url }, [h('div', { class: 'face' }, [logo(t.title, t.url, 46)]), h('div', { class: 'name', text: t.title })]);
      const edit = h('button', { type: 'button', title: 'Edit', 'aria-label': `Edit ${t.title}` }, [icon('edit')]);
      const del = h('button', { type: 'button', title: 'Remove', 'aria-label': `Remove ${t.title}` }, [icon('close')]);
      edit.addEventListener('click', (e) => { e.stopPropagation(); openTile(t); });
      del.addEventListener('click', (e) => { e.stopPropagation(); saveDial(list.filter((x) => x.id !== t.id)); });
      el.append(h('div', { class: 'more' }, [edit, del]));
      el.addEventListener('click', () => go(t.url, false));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) go(t.url, true); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(t.url, false); });
      return el;
    });
    if (list.length < 24) {
      const add = h('div', { class: 'tile add', role: 'button', tabindex: '0' }, [h('div', { class: 'face' }, [icon('plus')]), h('div', { class: 'name', text: 'Add shortcut' })]);
      add.addEventListener('click', () => openTile(null));
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTile(null); });
      tiles.push(add);
    }
    $('#dial').replaceChildren(...tiles);
  }

  let editing = null;
  function openTile(t) {
    editing = t;
    $('#tile-heading').textContent = t ? 'Edit shortcut' : 'Add shortcut';
    $('#tile-title').value = t ? t.title : '';
    $('#tile-url').value = t ? t.url : '';
    $('#tile-error').hidden = true;
    $('#modal').hidden = false;
    $('#tile-title').focus();
  }
  const closeTile = () => { $('#modal').hidden = true; };
  $('#tile-cancel').addEventListener('click', closeTile);
  $('#modal').addEventListener('mousedown', (e) => { if (e.target === $('#modal')) closeTile(); });
  async function saveTile() {
    let url = $('#tile-url').value.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    const title = $('#tile-title').value.trim();
    const list = settings.newtab.speedDial;
    const next = editing ? list.map((x) => (x.id === editing.id ? { ...x, title, url } : x)) : [...list, { id: `sd${Date.now().toString(36)}`, title, url }];
    try {
      settings = await call('settings:set', { newtab: { speedDial: next } }).then((s) => ({ ...settings, newtab: s.newtab }));
      closeTile();
      renderDial();
    } catch (err) { $('#tile-error').textContent = err.message; $('#tile-error').hidden = false; }
  }
  $('#tile-save').addEventListener('click', saveTile);
  $('#tile-form').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveTile(); } else if (e.key === 'Escape') closeTile(); });

  // ------------------------------------------------------------ appearance
  const BG = { ember: 'bg-ember', graphite: 'bg-graphite', midnight: 'bg-midnight', custom: 'bg-custom' };
  let wallpapers = [];
  function applySettings(r) {
    settings = r.settings;
    wallpapers = r.wallpapers || [];
    document.documentElement.dataset.accent = settings.accent;
    const hl = settings.homeLogo;
    const logo = $('#logo');
    const want = hl.image ? `zentro://homelogo/logo?rev=${hl.rev}` : 'zentro://assets/logo.png';
    if (logo.dataset.src !== want) {
      logo.dataset.src = want;
      logo.onerror = () => { logo.onerror = null; logo.classList.remove('custom'); logo.src = 'zentro://assets/logo.png'; };
      logo.src = want;
    }
    logo.classList.toggle('custom', hl.image);
    $('#logo-reset').hidden = !hl.image;
    engines = r.engines;
    let bg = settings.newtab.background;
    const wp = settings.newtab.wallpaper;
    if (bg === 'custom' && !(wp && wallpapers.some((w) => w.id === wp))) bg = 'ember';
    document.body.className = BG[bg];
    const picked = wallpapers.find((w) => w.id === wp);
    const isVideo = bg === 'custom' && !!(picked && picked.video);
    document.body.style.backgroundImage = bg === 'custom' && !isVideo ? `url(zentro://wallpaper/${wp})` : '';
    setVideo(isVideo ? wp : null);
    $('#q').placeholder = `Search ${engines[settings.searchEngine] || 'the web'} or enter an address`;
    $('#t-recent').checked = settings.newtab.showRecent;
    $('#t-stats').checked = settings.newtab.showStats;
    renderDial();
    renderSwatches();
    loadExtras();
  }

  function renderSwatches() {
    const bgs = [['ember', 'linear-gradient(135deg,#7a0e1c,#0b0b0e)', 'Ember'], ['graphite', 'linear-gradient(135deg,#3a3a42,#0c0c0f)', 'Graphite'], ['midnight', 'linear-gradient(135deg,#3b4390,#06060a)', 'Midnight']];
    $('#swatches').replaceChildren(...bgs.map(([k, grad, label]) => {
      const b = h('button', { class: 'swatch', type: 'button', title: label, 'aria-label': `${label} background`, 'aria-pressed': String(settings.newtab.background === k) });
      b.style.background = grad;
      b.addEventListener('click', () => call('settings:set', { newtab: { background: k } }).catch(swallow));
      return b;
    }));
    $('#uploads-label').hidden = wallpapers.length === 0;
    $('#uploads').replaceChildren(...wallpapers.map((w) => {
      const b = h('div', { class: 'swatch upload', role: 'button', tabindex: '0', title: 'Use this background', 'aria-label': 'Use this background', 'aria-pressed': String(settings.newtab.background === 'custom' && settings.newtab.wallpaper === w.id) });
      if (w.video) {
        const v = h('video', { preload: 'metadata', playsinline: '', 'aria-hidden': 'true' });
        v.muted = true; v.src = `zentro://wallpaper/${w.id}#t=0.5`;
        b.append(v);
        b.title = 'Use this video background';
      } else b.style.backgroundImage = `url(zentro://wallpaper/${w.id})`;
      const use = () => call('settings:set', { newtab: { background: 'custom', wallpaper: w.id } }).catch(swallow);
      b.addEventListener('click', use);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(); });
      const del = h('button', { class: 'del', type: 'button', title: 'Remove this background', 'aria-label': 'Remove this background' }, [icon('close')]);
      del.addEventListener('click', (e) => { e.stopPropagation(); call('wallpapers:remove', w.id).then(refresh).catch((err) => toast(err.message)); });
      b.append(del);
      return b;
    }));
    const acc = [['red', '#e11d2e', 'Red'], ['ember', '#ff5a1f', 'Ember'], ['rose', '#ff3d7f', 'Rose'], ['steel', '#7f93ad', 'Steel']];
    $('#accents').replaceChildren(...acc.map(([k, c, label]) => {
      const b = h('button', { class: 'swatch', type: 'button', title: label, 'aria-label': `${label} accent`, 'aria-pressed': String(settings.accent === k) });
      b.style.background = c;
      b.addEventListener('click', () => call('settings:set', { accent: k }).catch(swallow));
      return b;
    }));
  }

  async function loadExtras() {
    try {
      const d = await call('newtab:data');
      const recent = settings.newtab.showRecent ? d.recent : [];
      $('#recent-wrap').hidden = recent.length === 0;
      $('#recent').replaceChildren(...recent.map((r) => {
        const c = h('button', { class: 'chip', type: 'button', title: r.url }, [logo(r.title, r.url, 22), h('span', { text: r.title })]);
        c.addEventListener('click', () => go(r.url, false));
        return c;
      }));
      const st = $('#stats');
      st.hidden = !settings.newtab.showStats;
      const since = new Date(d.stats.since).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
      $('#stats-text').textContent = d.stats.blockedTotal > 0
        ? `Zentro Shield has blocked ${d.stats.blockedTotal.toLocaleString()} ad and tracker requests since ${since}.`
        : 'Zentro Shield is ready. Blocked ad and tracker requests will be counted here.';
    } catch { /* optional extras */ }
  }

  $('#customize').addEventListener('click', () => { $('#drawer').hidden = !$('#drawer').hidden; });
  $('#drawer-close').addEventListener('click', () => { $('#drawer').hidden = true; });
  $('#pick-wallpaper').addEventListener('click', () => call('wallpapers:add').then(refresh).catch((err) => toast(err.message)));

  // drop an image anywhere on the page to use it as the background
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    for (const f of [...(e.dataTransfer.files || [])].filter((x) => /^image\//.test(x.type)).slice(0, 5)) {
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error('That image is larger than 15 MB.');
        await call('wallpapers:add-data', { data: new Uint8Array(await f.arrayBuffer()) });
      } catch (err) { toast(err.message); }
    }
    refresh();
  });
  $('#t-recent').addEventListener('change', (e) => call('settings:set', { newtab: { showRecent: e.target.checked } }).catch(swallow));
  $('#t-stats').addEventListener('change', (e) => call('settings:set', { newtab: { showStats: e.target.checked } }).catch(swallow));

  const refresh = () => call('settings:get').then(applySettings).catch(swallow);
  on('settings-changed', refresh);
  on('stats-changed', loadExtras);
  on('history-changed', loadExtras);
  refresh();
  $('#q').focus();
  // The big Z opens your Zentro account page.
  const zLogo = document.getElementById('logo');
  if (zLogo) { zLogo.style.cursor = 'pointer'; zLogo.addEventListener('click', () => call('nav:open', { text: 'zentro://account/' }).catch(() => {})); }
  $('#logo-edit').addEventListener('click', () => call('homelogo:choose').then((r) => { if (r) toast('Logo updated.'); }).catch((err) => toast(err.message)));
  $('#logo-reset').addEventListener('click', () => call('homelogo:remove').catch((err) => toast(err.message)));
})();
