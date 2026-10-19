'use strict';
(() => {
  const { h, call, toast } = window.Z;
  const art = document.getElementById('article');
  let size = 19;
  const apply = () => art.style.setProperty('--size', `${size}px`);
  document.getElementById('smaller').addEventListener('click', () => { size = Math.max(14, size - 1); apply(); });
  document.getElementById('bigger').addEventListener('click', () => { size = Math.min(30, size + 1); apply(); });
  const id = new URLSearchParams(location.search).get('id') || '';
  call('reader:get', id).then((a) => {
    document.title = `${a.title || 'Article'} - Reading mode`;
    const nodes = [h('h1', { text: a.title || 'Article' }), h('p', { class: 'source', text: new URL(a.url).hostname })];
    let list = null;
    for (const b of a.blocks) {
      if (b.t === 'li') { if (!list) { list = h('ul'); nodes.push(list); } list.append(h('li', { text: b.text })); continue; }
      list = null;
      if (b.t === 'img') nodes.push(h('img', { src: b.src, alt: b.text || '', referrerpolicy: 'no-referrer', loading: 'lazy' }));
      else if (b.t === 'pre') nodes.push(h('pre', { text: b.text }));
      else nodes.push(h(b.t === 'h1' ? 'h2' : b.t, { text: b.text }));
    }
    art.replaceChildren(...nodes);
    document.getElementById('original').addEventListener('click', () => call('nav:open', { text: a.url }).catch((e) => toast(e.message)));
  }).catch((e) => { art.replaceChildren(h('p', { class: 'muted', text: e.message })); });
})();
