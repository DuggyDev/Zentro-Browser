'use strict';
(() => {
  const { h, icon, call, on } = window.Z;
  const $ = (s) => document.querySelector(s);
  const swallow = () => {};
  const BUILTIN_ICON = { bookmarks: 'bookmark', history: 'history', downloads: 'download', collections: 'collections' };
  $('#vnew').append(icon('plus'));
  $('#vnew').addEventListener('click', () => call('tab:new').catch(swallow));

  function render(S) {
    document.documentElement.dataset.accent = S.accent;
    const L = S.layout;
    $('#wrap').style.gridTemplateColumns = `${L.rail}px ${L.vtabs}px`;
    $('#vtabs').hidden = L.pos !== 'left';
    const rail = $('#rail');
    rail.hidden = !L.sidebar.enabled;
    rail.classList.toggle('compact', L.sidebar.mode !== 'expanded');
    const parts = [];
    L.sidebar.items.forEach((it, i) => {
      if (!it.builtin && i > 0 && L.sidebar.items[i - 1].builtin) parts.push(h('div', { class: 'rail-sep', role: 'separator' }));
      const b = h('button', { class: `rail-item${L.sidebar.active === it.id ? ' active' : ''}`, type: 'button', title: `${it.name}${i < 9 ? ` (Ctrl+Alt+${i + 1})` : ''}`, 'aria-label': it.name },
        [it.builtin ? icon(BUILTIN_ICON[it.id] || 'globe') : window.Z.siteLogo(it.name, it.url, 22), h('span', { class: 'rail-label', text: it.name })]);
      b.addEventListener('click', () => call('sidebar:toggle', it.id).catch(swallow));
      parts.push(b);
    });
    const add = h('button', { class: 'rail-item', type: 'button', title: 'Add apps (WhatsApp, Discord, Mail...)', 'aria-label': 'Add apps to the sidebar' }, [icon('plus'), h('span', { class: 'rail-label', text: 'Add apps' })]);
    add.addEventListener('click', () => call('nav:open', { text: 'zentro://settings/#sidebar', newTab: true }).catch(swallow));
    const settings = h('button', { class: 'rail-item', type: 'button', title: 'Settings', 'aria-label': 'Settings' }, [icon('sliders'), h('span', { class: 'rail-label', text: 'Settings' })]);
    settings.addEventListener('click', () => call('nav:open', { text: 'zentro://settings/', newTab: true }).catch(swallow));
    rail.replaceChildren(...parts, add, h('div', { class: 'rail-spacer' }), settings);
    if (L.pos === 'left') window.ZTabs.render($('#vlist'), S.tabs);
  }

  on('state', render);
  call('ui:state').then(render).catch(swallow);
})();
