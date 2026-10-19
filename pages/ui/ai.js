'use strict';
(() => {
  const { call, on, icon, aiLogo, h } = window.Z;
  const $ = (s) => document.querySelector(s);
  let st = null;
  let toastTimer = 0;
  let lastNotice = 0;
  let sig = '';

  $('#share-btn').append(icon('sparkles'));
  $('#login').append(icon('user'));
  $('#fix').append(icon('wrench'));
  $('#size').append(icon('fullscreen'));
  $('#new').append(icon('plus'));
  $('#close').append(icon('close'));

  // The header view is only 46px tall. Menus and messages need room, so the view grows while they are visible.
  const sync = () => call('ai:extra', ($('#share-menu').hidden ? 0 : 200) + ($('#msg').hidden ? 0 : ($('#msg').textContent.length > 70 ? 100 : 58))).catch(() => {});
  const say = (text, ms = 3600) => {
    const m = $('#msg'); m.textContent = text; m.hidden = false; sync();
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { m.hidden = true; sync(); }, ms);
  };
  const guard = (p) => p.catch((e) => say(e.message || 'Something went wrong.'));
  const closeMenu = () => { if ($('#share-menu').hidden) return; $('#share-menu').hidden = true; $('#share-btn').setAttribute('aria-expanded', 'false'); sync(); };

  function draw() {
    if (!st) return;
    document.body.dataset.size = st.size || 'm';
    const provs = $('#provs');
    // Only rebuild the logo buttons when the list itself changed; a new state must not make the logos blink.
    const next = st.providers.map((p) => `${p.id}:${p.name}:${p.host}`).join('|');
    if (next !== sig) {
      sig = next;
      provs.replaceChildren(...st.providers.map((p) => {
        const b = h('button', { class: 'prov', type: 'button', title: p.name, 'aria-label': p.name, role: 'tab', 'data-id': p.id }, [aiLogo(p, 20), h('span', { class: 'prov-name', text: p.name })]);
        b.addEventListener('click', () => guard(call('ai:provider', p.id)));
        return b;
      }));
    }
    for (const b of provs.children) b.setAttribute('aria-selected', String(b.dataset.id === st.provider));
    $('#dot').classList.toggle('on', !!st.loading);
    if (st.notice && st.notice.id !== lastNotice) { lastNotice = st.notice.id; say(st.notice.text, 9000); }
  }
  on('ai-state', (s) => { st = s; draw(); });
  call('ai:state').then((s) => { st = s; draw(); }).catch(() => {});

  // ---- drag the whole panel by its handle (screen coordinates, so it follows the pointer exactly)
  const grip = $('#grip');
  let drag = null; let queued = { dx: 0, dy: 0 }; let raf = 0;
  grip.addEventListener('pointerdown', (e) => { drag = { x: e.screenX, y: e.screenY }; grip.setPointerCapture(e.pointerId); closeMenu(); });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    queued.dx += e.screenX - drag.x; queued.dy += e.screenY - drag.y; drag = { x: e.screenX, y: e.screenY };
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = { dx: 0, dy: 0 }; call('ai:move', q).catch(() => {}); });
  });
  const stop = () => { drag = null; };
  grip.addEventListener('pointerup', stop); grip.addEventListener('pointercancel', stop);

  $('#share-btn').addEventListener('click', () => {
    const m = $('#share-menu'); m.hidden = !m.hidden; $('#share-btn').setAttribute('aria-expanded', String(!m.hidden)); sync();
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#share')) closeMenu(); });
  for (const b of document.querySelectorAll('#share-menu button')) {
    b.addEventListener('click', () => { closeMenu(); say(b.dataset.kind === 'screenshot' ? 'Taking a screenshot\u2026' : 'Adding it to the message box\u2026'); guard(call('ai:share', b.dataset.kind).then(() => { say('Added. Press Send in the assistant when you are ready.'); })); });
  }
  $('#size').addEventListener('click', () => { closeMenu(); const next = { s: 'm', m: 'l', l: 's' }[(st && st.size) || 'm']; guard(call('ai:size', next)); });
  $('#login').addEventListener('click', () => {
    closeMenu();
    say('Opening the sign-in page. Zentro presses \u201CContinue with Google\u201D for you; finish on Google\u2019s page.');
    guard(call('ai:login'));
  });
  $('#fix').addEventListener('click', () => { closeMenu(); guard(call('ai:fix')); });
  $('#new').addEventListener('click', () => { closeMenu(); guard(call('ai:new')); });
  $('#close').addEventListener('click', () => guard(call('ai:close')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);
})();
