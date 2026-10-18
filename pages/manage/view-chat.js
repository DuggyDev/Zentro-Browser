'use strict';
/** Zentro chat: text rooms for everyone signed in to Zentro. Needs the Zentro server (see SETUP.md). */
(() => {
  const { h, icon, call, Views, empty } = window.M;

  Views.chat = async ({ view }) => {
    const rooms = await call('chat:rooms').catch(() => []);
    let room = rooms[0] ? rooms[0].id : 'general';
    let after = 0; let epoch = ''; let me = ''; let timer = 0; let loading = false; let gen = 0;

    const status = h('p', { class: 'chat-status', role: 'status' });
    const list = h('div', { class: 'chat-list', 'aria-live': 'polite', 'aria-label': 'Messages' });
    const input = h('input', { type: 'text', maxlength: '400', placeholder: 'Write a message\u2026', 'aria-label': 'Message' });
    const sendBtn = h('button', { class: 'btn btn-primary', type: 'button', title: 'Send', 'aria-label': 'Send message' }, [icon('send')]);
    const tabs = h('div', { class: 'seg' });

    const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    function draw(r) {
      const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (r.epoch !== epoch) { epoch = r.epoch; after = 0; list.replaceChildren(); }
      me = r.me;
      for (const m of r.messages) {
        if (m.id <= after) continue;
        after = m.id;
        list.append(h('div', { class: `chat-msg${m.name === me ? ' mine' : ''}` }, [
          h('div', { class: 'chat-meta' }, [h('b', { text: m.name }), h('span', { class: 'chat-tag', text: `#${m.tag}` }), h('span', { class: 'chat-time', text: fmtTime(m.at) })]),
          h('div', { class: 'chat-text', text: m.text })]));
      }
      if (!list.children.length) list.append(h('div', { class: 'chat-empty', text: 'No messages yet. Say hi!' }));
      else { const e = list.querySelector('.chat-empty'); if (e) e.remove(); }
      if (near) list.scrollTop = list.scrollHeight;
    }

    async function poll() {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      const my = gen;
      try { const r = await call('chat:list', { room, after, epoch }); if (my === gen) { status.textContent = ''; draw(r); } } catch (e) { if (my === gen) status.textContent = e.message; }
      loading = false;
    }
    function pick(id) {
      room = id; after = 0; epoch = ''; gen += 1; loading = false;
      list.replaceChildren();
      tabs.replaceChildren(...rooms.map((r) => h('button', { type: 'button', text: r.name, 'aria-pressed': String(r.id === room), on: { click: () => pick(r.id) } })));
      poll();
    }
    async function send() {
      const text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try { await call('chat:send', { room, text }); input.value = ''; status.textContent = ''; await poll(); } catch (e) { status.textContent = e.message; }
      sendBtn.disabled = false;
      input.focus();
    }
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

    view.replaceChildren(
      h('section', { class: 'section' }, [h('h2', { text: 'Chat' }),
        h('div', { class: 'card chat-card' }, [
          tabs,
          list,
          status,
          h('div', { class: 'chat-compose' }, [input, sendBtn]),
          h('p', { class: 'sch-note', text: 'Everyone signed in to Zentro can read these rooms. Others see your display name and a short code, never your email. Links are removed. Do not share your address, school or phone number.' }),
        ])]),
    );
    if (!rooms.length) view.append(empty('chat', 'Chat is not available', 'Update Zentro and try again.'));
    pick(room);
    timer = setInterval(poll, 3000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('pagehide', () => clearInterval(timer));
  };
})();
