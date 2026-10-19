'use strict';
/** Helpers shared by every Zentro page. Text goes in through textContent only, never innerHTML. */
(() => {
  const api = window.zentro;
  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>', forward: '<path d="M9 5l7 7-7 7"/>',
    reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', stop: '<path d="M6 6l12 12M18 6L6 18"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
    'star-fill': '<path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    'shield-off': '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M5 5l14 14"/>',
    menu: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>', puzzle: '<path d="M10 4h4v3a2 2 0 1 0 0 4h3v4h-3a2 2 0 1 1-4 0v0H7v-4h3a2 2 0 1 0 0-4V4z" transform="translate(0 1)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.3"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.3"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
    volume: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/>', mute: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4M12 8v4l3 2"/>', bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
    collections: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M7 4h10"/>', sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    up: '<path d="M6 14l6-6 6 6"/>', down: '<path d="M6 10l6 6 6-6"/>', external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    retry: '<path d="M4 4v6h6M20 20v-6h-6"/><path d="M5.6 15a8 8 0 0 0 13.9-1.5M18.4 9A8 8 0 0 0 4.5 10.5"/>', check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', reader: '<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M9 11h4M11 9v4"/>', window: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
    private: '<path d="M4 13c1-5 3-7 8-7s7 2 8 7"/><circle cx="8" cy="15" r="2.5"/><circle cx="16" cy="15" r="2.5"/>', print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><rect x="7" y="14" width="10" height="6"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>', crown: '<path d="M4 8l4 4 4-7 4 7 4-4-2 11H6z"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.5-.7-.7-2.5z"/>',
    school: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11.5V16c2 1.6 8 1.6 10 0v-4.5M21 9v6"/>', chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>', note: '<path d="M6 4h12v16H6z"/><path d="M9 9h6M9 13h6M9 17h3"/>', grade: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    send: '<path d="M4 12l16-8-6 16-3-6.5z"/><path d="M11 13.5L20 4"/>', 'tab-top': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>', 'tab-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    'tab-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>', 'tab-bottom': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }
  function h(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of [].concat(kids)) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const v = n / 1024 ** i;
    return `${i === 0 || v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  /** Stable colour from a string, drawn from the dark red/charcoal family so tiles feel on-brand. */
  function tint(seed) {
    let n = 0;
    for (const c of String(seed)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    const hue = [350, 8, 340, 18, 0, 355][n % 6];
    return `linear-gradient(145deg, hsl(${hue} 62% 38%), hsl(${hue} 55% 20%))`;
  }
  function avatar(title, url, size = 44) {
    const el = h('div', { class: 'avatar', text: (title || hostOf(url) || '?').trim().charAt(0) || '?' });
    el.style.width = el.style.height = `${size}px`;
    el.style.fontSize = `${Math.round(size * 0.42)}px`;
    el.style.background = tint(hostOf(url) || title);
    return el;
  }
  /** Profile picture. style: aurora | pulse | orbit | flow | sparkle. imageUrl (a GIF animates by itself) replaces the letter. */
  function avatarEl({ style = 'aurora', label = '?', size = 34, imageUrl = null } = {}) {
    const face = h('span', { class: 'face' });
    if (imageUrl) {
      const img = h('img', { alt: '', draggable: 'false' });
      img.addEventListener('error', () => { img.remove(); face.textContent = String(label).charAt(0).toUpperCase() || '?'; });
      img.src = imageUrl;
      face.append(img);
    } else face.textContent = String(label).charAt(0).toUpperCase() || '?';
    const el = h('span', { class: 'zav', 'data-style': style }, [face]);
    el.style.setProperty('--s', `${size}px`);
    return el;
  }
  /**
   * A PNG logo for any site: the logo Zentro saved from the site itself (zentro://favicon/<host>), with a coloured
   * letter tile underneath that shows until the logo arrives (or when the site has none).
   */
  function siteLogo(title, url, size = 28) {
    const tile = avatar(title, url, size);
    const host = hostOf(url);
    const wrap = h('span', { class: 'site-logo' }, [tile]);
    wrap.style.width = wrap.style.height = `${size}px`;
    if (host && host.includes('.')) {
      const img = h('img', { alt: '', draggable: 'false' });
      img.addEventListener('load', () => { wrap.replaceChildren(img); wrap.classList.add('has-logo'); });
      img.src = `zentro://favicon/${encodeURIComponent(host)}`;
    }
    return wrap;
  }
  /** Logo of an AI assistant: a bundled PNG if you added one (pages/shared/ai-<id>.png), else the logo from its own site, else a letter. */
  function aiLogo(p, size = 18) {
    const tile = avatar(p.name, p.host ? `https://${p.host}/` : '', size);
    const wrap = h('span', { class: 'site-logo ai-logo' }, [tile]);
    wrap.style.width = wrap.style.height = `${size}px`;
    const chain = [`zentro://assets/ai-${encodeURIComponent(p.id)}.png`, p.host && p.host.includes('.') ? `zentro://favicon/${encodeURIComponent(p.host)}` : null].filter(Boolean);
    const next = (i) => {
      if (i >= chain.length) return;
      const img = h('img', { alt: '', draggable: 'false' });
      img.addEventListener('error', () => next(i + 1));
      img.addEventListener('load', () => { wrap.replaceChildren(img); wrap.classList.add('has-logo'); });
      img.src = chain[i];
    };
    next(0);
    return wrap;
  }
  function toast(message) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', class: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast', role: 'status', text: message });
    box.append(t);
    setTimeout(() => t.remove(), 4000);
  }
  async function applyAccent() {
    try {
      const r = await api.call('settings:get');
      document.documentElement.dataset.accent = r.settings.accent;
      document.documentElement.dataset.anim = r.settings.animations === false ? 'off' : 'on';
    } catch { /* default accent */ }
  }
  api.on('settings-changed', applyAccent);
  window.Z = { call: api.call, on: api.on, icon, h, fmtBytes, fmtDate, hostOf, avatar, avatarEl, siteLogo, aiLogo, toast, applyAccent, tint };
  applyAccent();
})();
