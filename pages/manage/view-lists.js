'use strict';
(() => {
  const { h, icon, call, toast, Views, form, empty, ibtn, open, fail } = window.M;
  const { on, avatar, hostOf, fmtBytes, fmtDate } = window.Z;
  const panel = document.body.classList.contains('panel') || new URLSearchParams(location.search).get('panel') === '1';
  const go = (url) => open(url, panel);
  const dayLabel = (ts) => {
    const d = new Date(ts); const t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Today';
    const y = new Date(t); y.setDate(t.getDate() - 1);
    return d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  // ------------------------------------------------------------ history
  Views.history = ({ view, actions }) => {
    let query = ''; let limit = 200;
    const search = h('input', { type: 'search', placeholder: 'Search history', 'aria-label': 'Search history' });
    actions.append(h('button', { class: 'btn', type: 'button', on: { click: () => open('zentro://settings/#privacy', true) } }, [icon('trash'), h('span', { text: 'Clear browsing data' })]));
    const list = h('div', { class: 'list' });
    view.append(h('div', { class: 'toolbar' }, [search]), list);
    async function load() {
      try {
        const r = await call('history:list', { query, limit });
        if (!r.items.length) { list.replaceChildren(empty('history', query ? 'No matches' : 'No history yet', query ? 'Try a different search.' : 'Pages you visit will be listed here. Private windows are never recorded.')); return; }
        const nodes = []; let day = '';
        for (const e of r.items) {
          const l = dayLabel(e.lastVisit);
          if (l !== day) { day = l; nodes.push(h('div', { class: 'group-title', text: l })); }
          const row = h('div', { class: 'item click', role: 'link', tabindex: '0' }, [avatar(e.title, e.url, 32),
            h('div', { class: 'grow' }, [h('div', { class: 't', text: e.title || e.url }), h('div', { class: 's', text: hostOf(e.url) })]),
            h('span', { class: 'when', text: new Date(e.lastVisit).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }),
            ibtn('close', 'Remove from history', () => call('history:remove', e.url).catch(fail), 'danger')]);
          row.addEventListener('click', () => go(e.url));
          row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(e.url); });
          nodes.push(row);
        }
        if (r.total > r.items.length) nodes.push(h('button', { class: 'btn', type: 'button', text: 'Show more', on: { click: () => { limit += 200; load(); } } }));
        list.replaceChildren(...nodes);
      } catch (err) { fail(err); }
    }
    let t = 0;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = search.value; limit = 200; load(); }, 120); });
    on('history-changed', load);
    load();
  };

  // ------------------------------------------------------------ bookmarks
  Views.bookmarks = ({ view, actions }) => {
    let data = { folders: [], bookmarks: [] }; let folder = 'all'; let query = '';
    const search = h('input', { type: 'search', placeholder: 'Search bookmarks', 'aria-label': 'Search bookmarks' });
    const folders = h('div', { class: 'folders' });
    const list = h('div', { class: 'list' });
    actions.append(
      h('button', { class: 'btn', type: 'button', on: { click: async () => { const v = await form({ title: 'New folder', fields: [{ name: 'name', label: 'Folder name', max: 80 }], ok: 'Create' }); if (v && v.name) call('folders:add', v.name).catch(fail); } } }, [icon('folder'), h('span', { text: 'New folder' })]),
      h('button', { class: 'btn', type: 'button', on: { click: () => call('bookmarks:import').then((n) => { if (n !== null) toast(`Imported ${n} bookmark${n === 1 ? '' : 's'}.`); }).catch(fail) } }, [h('span', { text: 'Import' })]),
      h('button', { class: 'btn', type: 'button', on: { click: () => call('bookmarks:export').then((ok) => { if (ok) toast('Bookmarks exported.'); }).catch(fail) } }, [h('span', { text: 'Export' })]));
    view.append(h('div', { class: 'toolbar' }, [search]), folders, list);

    function draw() {
      const chip = (id, label, extra) => { const b = h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(folder === id) }, [h('span', { text: label }), ...(extra || [])]); b.addEventListener('click', () => { folder = id; draw(); }); return b; };
      folders.replaceChildren(chip('all', `All (${data.bookmarks.length})`), chip('none', 'No folder'),
        ...data.folders.map((f) => chip(f.id, f.name, folder === f.id ? [
          ibtn('edit', 'Rename folder', async () => { const v = await form({ title: 'Rename folder', fields: [{ name: 'name', label: 'Folder name', value: f.name, max: 80 }] }); if (v && v.name) call('folders:rename', { id: f.id, name: v.name }).catch(fail); }),
          ibtn('trash', 'Delete folder (bookmarks are kept)', async () => { const v = await form({ title: `Delete \u201C${f.name}\u201D?`, text: 'The bookmarks inside are kept and moved out of the folder.', ok: 'Delete', danger: true }); if (v) { folder = 'all'; call('folders:remove', f.id).catch(fail); } }, 'danger')] : [])));
      const q = query.toLowerCase();
      const rows = data.bookmarks.filter((b) => (folder === 'all' || (folder === 'none' ? !b.folderId : b.folderId === folder)) && (!q || `${b.title} ${b.url}`.toLowerCase().includes(q)));
      if (!rows.length) { list.replaceChildren(empty('bookmark', q ? 'No matches' : 'No bookmarks here', 'Press the star in the address bar (Ctrl+D) to bookmark a page.')); return; }
      list.replaceChildren(...rows.map((b) => {
        const row = h('div', { class: 'item click', role: 'link', tabindex: '0' }, [avatar(b.title, b.url, 32),
          h('div', { class: 'grow' }, [h('div', { class: 't', text: b.title }), h('div', { class: 's', text: b.url })]),
          ibtn('edit', 'Edit bookmark', async () => {
            const v = await form({ title: 'Edit bookmark', fields: [{ name: 'title', label: 'Name', value: b.title }, { name: 'url', label: 'Address', value: b.url, max: 2048 },
              { name: 'folderId', label: 'Folder', type: 'select', value: b.folderId || '', options: [['', 'No folder'], ...data.folders.map((f) => [f.id, f.name])] }] });
            if (v) call('bookmarks:update', { id: b.id, title: v.title, url: v.url, folderId: v.folderId || null }).catch(fail);
          }),
          ibtn('trash', 'Delete bookmark', () => call('bookmarks:remove', b.id).catch(fail), 'danger')]);
        row.addEventListener('click', () => go(b.url));
        row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(b.url); });
        return row;
      }));
    }
    const load = () => call('bookmarks:list').then((d) => { data = d; if (folder !== 'all' && folder !== 'none' && !d.folders.some((f) => f.id === folder)) folder = 'all'; draw(); }).catch(fail);
    search.addEventListener('input', () => { query = search.value; draw(); });
    on('bookmarks-changed', load);
    load();
  };

  // ------------------------------------------------------------ downloads
  Views.downloads = ({ view, actions }) => {
    const list = h('div', { class: 'list' });
    actions.append(h('button', { class: 'btn', type: 'button', on: { click: () => call('downloads:clear').catch(fail) } }, [icon('trash'), h('span', { text: 'Clear finished' })]));
    view.append(list);
    const stateLabel = { progressing: 'Downloading', paused: 'Paused', completed: 'Completed', failed: 'Failed', canceled: 'Canceled' };
    async function load() {
      try {
        const items = await call('downloads:list');
        if (!items.length) { list.replaceChildren(empty('download', 'No downloads yet', 'Files you download will be listed here. Zentro never opens a download by itself.')); return; }
        list.replaceChildren(...items.map((d) => {
          const live = d.state === 'progressing' || d.state === 'paused';
          const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0;
          const meta = [stateLabel[d.state], d.state === 'completed' ? fmtBytes(d.totalBytes) : live ? `${fmtBytes(d.receivedBytes)}${d.totalBytes ? ' of ' + fmtBytes(d.totalBytes) : ''}` : '', live && d.state === 'progressing' && d.speed > 0 ? `${fmtBytes(d.speed)}/s` : '', d.error || '', d.missing ? 'File moved or deleted' : '', d.private ? 'Private' : '']
            .filter(Boolean).join('  \u2022  ');
          const btns = [];
          if (live) { btns.push(ibtn(d.state === 'paused' ? 'play' : 'pause', d.state === 'paused' ? 'Resume' : 'Pause', () => call(d.state === 'paused' ? 'downloads:resume' : 'downloads:pause', d.id).catch(fail))); btns.push(ibtn('close', 'Cancel', () => call('downloads:cancel', d.id).catch(fail), 'danger')); }
          else {
            if (d.state === 'completed') { const o = ibtn('external', 'Open file', () => call('downloads:open', d.id).catch(fail)); o.disabled = d.missing; btns.push(o, ibtn('folder', 'Show in folder', () => call('downloads:reveal', d.id).catch(fail))); }
            if (d.canRetry) btns.push(ibtn('retry', 'Try again', () => call('downloads:retry', d.id).catch(fail)));
            btns.push(ibtn('trash', 'Remove from list', () => call('downloads:remove', d.id).catch(fail), 'danger'));
          }
          const bar = live ? h('div', { class: 'bar' }, [(() => { const i = h('i'); i.style.width = `${pct}%`; return i; })()]) : null;
          return h('div', { class: 'item' }, [avatar(d.fileName, d.url || d.fileName, 36), h('div', { class: 'grow' }, [h('div', { class: 't', text: d.fileName, title: d.fileName }), bar, h('div', { class: 's', text: meta })]), ...btns]);
        }));
      } catch (err) { fail(err); }
    }
    on('downloads-changed', load);
    load();
  };

  // ------------------------------------------------------------ collections
  Views.collections = ({ view, actions }) => {
    let cols = []; let sel = null;
    actions.append(h('button', { class: 'btn btn-primary', type: 'button', on: { click: async () => { const v = await form({ title: 'New collection', fields: [{ name: 'name', label: 'Name', max: 80 }], ok: 'Create' }); if (v && v.name) { const c = await call('collections:create', v.name).catch(fail); if (c) sel = c.id; } } } }, [icon('plus'), h('span', { text: 'New collection' })]));
    const left = h('div', { class: 'list' }); const right = h('div', {});
    view.append(h('div', { class: 'cols' }, [left, right]));
    function draw() {
      if (!cols.length) { left.replaceChildren(); right.replaceChildren(empty('collections', 'No collections yet', 'Collections keep related websites and notes together. Create one, then add pages from the menu.')); return; }
      if (!cols.some((c) => c.id === sel)) sel = cols[0].id;
      left.replaceChildren(...cols.map((c) => { const b = h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(c.id === sel) }, [icon('collections'), h('span', { text: c.name }), h('span', { class: 'when', text: String(c.items.length) })]); b.style.justifyContent = 'flex-start'; b.addEventListener('click', () => { sel = c.id; draw(); }); return b; }));
      const c = cols.find((x) => x.id === sel);
      const head = h('div', { class: 'toolbar' }, [h('b', { text: c.name }), h('span', { style: null }),
        h('button', { class: 'btn', type: 'button', text: 'Add note', on: { click: async () => { const v = await form({ title: 'Add note', fields: [{ name: 'title', label: 'Title', max: 200 }, { name: 'text', label: 'Note', type: 'textarea' }], ok: 'Add' }); if (v && v.text) call('collections:add', { id: c.id, type: 'note', title: v.title || 'Note', text: v.text }).catch(fail); } } }),
        ibtn('edit', 'Rename collection', async () => { const v = await form({ title: 'Rename collection', fields: [{ name: 'name', label: 'Name', value: c.name, max: 80 }] }); if (v && v.name) call('collections:rename', { id: c.id, name: v.name }).catch(fail); }),
        ibtn('trash', 'Delete collection', async () => { const v = await form({ title: `Delete \u201C${c.name}\u201D?`, text: 'The sites and notes in this collection will be removed.', ok: 'Delete', danger: true }); if (v) call('collections:delete', c.id).catch(fail); }, 'danger')]);
      head.firstChild.style.flex = '1';
      const items = c.items.length ? c.items.map((it) => {
        const row = h('div', { class: `item${it.type === 'site' ? ' click' : ''}` }, [it.type === 'site' ? avatar(it.title, it.url, 32) : h('div', { class: 'avatar', text: '\u00b6' }),
          h('div', { class: 'grow' }, [h('div', { class: 't', text: it.title }), h('div', { class: 's', text: it.type === 'site' ? hostOf(it.url) : it.text, title: it.type === 'note' ? it.text : '' })]),
          ibtn('close', 'Remove', () => call('collections:remove-item', { id: c.id, itemId: it.id }).catch(fail), 'danger')]);
        if (it.type === 'note') { const a = row.querySelector('.avatar'); a.style.width = a.style.height = '32px'; a.style.background = 'var(--surface-3)'; a.style.color = 'var(--muted)'; }
        if (it.type === 'site') row.addEventListener('click', () => go(it.url));
        return row;
      }) : [empty('collections', 'This collection is empty', 'Use the menu, then \u201CAdd page to a collection\u201D, or add a note.')];
      right.replaceChildren(head, h('div', { class: 'list' }, items));
    }
    const load = () => call('collections:list').then((c) => { cols = c; draw(); }).catch(fail);
    on('collections-changed', load);
    load();
  };

  // ------------------------------------------------------------ extensions
  Views.extensions = ({ view, actions }) => {
    const list = h('div', { class: 'list' });
    actions.append(h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => call('extensions:add').then((e) => { if (e) toast(`Added ${e.name}.`); load(); }).catch(fail) } }, [icon('plus'), h('span', { text: 'Load unpacked extension' })]));
    const storeInput = h('input', { type: 'text', maxlength: '500', placeholder: 'Chrome Web Store link or extension id', 'aria-label': 'Chrome Web Store link or extension id', spellcheck: 'false' });
    const storeBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Install from Chrome Web Store' });
    const install = async () => {
      if (!storeInput.value.trim()) return;
      storeBtn.disabled = true; storeBtn.textContent = 'Installing\u2026';
      try { const e = await call('extensions:store-add', storeInput.value.trim()); if (e) { toast(`Installed ${e.name}.`); storeInput.value = ''; } } catch (err) { fail(err); }
      storeBtn.disabled = false; storeBtn.textContent = 'Install from Chrome Web Store'; load();
    };
    const storeRow = h('div', {}, [storeInput, storeBtn]);
    Object.assign(storeRow.style, { display: 'flex', gap: '8px', margin: '12px 0' });
    storeInput.style.flex = '1';
    storeBtn.addEventListener('click', install);
    storeInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') install(); });
    view.append(h('div', { class: 'notice', text: 'Zentro uses the partial extension support built into Electron, so only extensions that stick to the supported Chrome APIs work. Many do, some do not, and extension toolbar popups are not available. You can install from the Chrome Web Store (paste its link) or load an unpacked folder. Only add extensions you trust: they can read the pages you visit. Extensions do not run in private windows.' }), storeRow, list);
    async function load() {
      try {
        const items = await call('extensions:list');
        if (!items.length) { list.replaceChildren(empty('puzzle', 'No extensions added', 'Choose a folder that contains an extension\u2019s manifest.json.')); return; }
        list.replaceChildren(...items.map((e) => {
          const sw = h('label', { class: 'switch' }, [h('input', { type: 'checkbox', role: 'switch', 'aria-label': `Enable ${e.name}` }), h('i')]);
          sw.querySelector('input').checked = e.enabled;
          sw.querySelector('input').addEventListener('change', (ev) => call('extensions:enable', { path: e.path, enabled: ev.target.checked }).then(load).catch((err) => { fail(err); load(); }));
          return h('div', { class: 'item' }, [h('div', { class: 'avatar', text: (e.name || '?').charAt(0) }), h('div', { class: 'grow' }, [
            h('div', { class: 't', text: `${e.name} ${e.version}` }), h('div', { class: 's', text: e.path, title: e.path }),
            e.error ? h('div', { class: 'err', text: e.error }) : null,
            h('div', {}, (e.permissions || []).slice(0, 6).map((p) => h('span', { class: 'chipw', text: p })))]), sw,
          ibtn('trash', 'Remove extension', () => call('extensions:remove', e.path).then(load).catch(fail), 'danger')]);
        }));
        list.querySelectorAll('.avatar').forEach((a) => { a.style.width = a.style.height = '36px'; a.style.background = window.Z.tint(a.textContent); });
      } catch (err) { fail(err); }
    }
    load();
  };
})();
