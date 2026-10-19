'use strict';
/** Renders the tab list for both the horizontal strip and the vertical tab panel (keyed, so nothing flickers). */
(() => {
  const { h, icon, call } = window.Z;
  const els = new WeakMap();

  function make(container) {
    const el = h('div', { class: 'tab', draggable: 'true' }, [
      h('span', { class: 'tab-fav' }), h('span', { class: 'tab-title' }),
      h('span', { class: 'tab-audio' }),
      h('button', { class: 'tab-close', type: 'button', title: 'Close tab', 'aria-label': 'Close tab' }, [icon('close')]),
    ]);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) { e.stopPropagation(); call('tab:close', el._id).catch(() => {}); } else call('tab:activate', el._id).catch(() => {});
    });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); call('tab:close', el._id).catch(() => {}); } });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); call('tab:menu', el._id).catch(() => {}); });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-zentro-tab', String(el._id)); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-zentro-tab')) { e.preventDefault(); el.classList.add('drop-before'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-before');
      const id = Number(e.dataTransfer.getData('text/x-zentro-tab'));
      const index = [...container.children].indexOf(el);
      if (id && id !== el._id) call('tab:move', { id, index }).catch(() => {});
    });
    return el;
  }

  function fill(el, t) {
    el._id = t.id;
    el.classList.toggle('active', t.active);
    el.classList.toggle('pinned', t.pinned);
    el.classList.toggle('loading', t.loading);
    el.classList.toggle('sleeping', t.sleeping);
    el.title = t.title;
    el.querySelector('.tab-title').textContent = t.title;
    const fav = el.querySelector('.tab-fav');
    // Every tab gets a PNG logo: the page's own icon, else the site's logo saved by Zentro, else a neutral icon. Zentro pages show the Zentro logo.
    const host = (() => { try { const u = new URL(t.url); return /^https?:$/.test(u.protocol) ? u.hostname : ''; } catch { return ''; } })();
    const key = `${t.favicon || ''}|${host}|${t.url.startsWith('zentro:') ? 'z' : ''}`;
    if (fav._key !== key || !fav.firstChild) {
      fav._key = key;
      fav.replaceChildren();
      const fallback = () => fav.replaceChildren(icon(t.url.startsWith('zentro:') ? 'shield' : 'globe'));
      const chain = t.url.startsWith('zentro:') ? ['zentro://assets/icon.png'] : [t.favicon, host && host.includes('.') ? `zentro://favicon/${host}` : null].filter(Boolean);
      const next = (i) => {
        if (i >= chain.length) { fallback(); return; }
        const img = h('img', { alt: '', width: '16', height: '16', draggable: 'false' });
        img.addEventListener('error', () => next(i + 1));
        img.addEventListener('load', () => { if (fav._key === key) fav.replaceChildren(img); });
        img.src = chain[i];
      };
      fallback();
      next(0);
    }
    const audio = el.querySelector('.tab-audio');
    audio.replaceChildren(...(t.muted ? [icon('mute')] : t.audible ? [icon('volume')] : []));
  }

  function render(container, tabs) {
    const keep = new Set();
    tabs.forEach((t, i) => {
      keep.add(t.id);
      let el = els.get(container) && els.get(container).get(t.id);
      if (!el) {
        el = make(container);
        if (!els.has(container)) els.set(container, new Map());
        els.get(container).set(t.id, el);
      }
      fill(el, t);
      const at = container.children[i] || null;
      if (at !== el) container.insertBefore(el, at);
    });
    const map = els.get(container);
    if (map) for (const [id, el] of map) if (!keep.has(id)) { el.remove(); map.delete(id); }
  }

  window.ZTabs = { render };
})();
