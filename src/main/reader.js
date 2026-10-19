'use strict';
/** Reading mode: pull the main text of a page into a clean, text-only article. */
const crypto = require('crypto');

// Runs inside the page. Only READS the DOM and returns plain data.
const EXTRACT = `(() => {
  const score = (el) => { let s = 0; for (const p of el.querySelectorAll('p')) { const t = p.innerText || ''; if (t.length > 60) s += t.length; } return s; };
  let best = document.body, bs = -1;
  for (const c of document.querySelectorAll('article, main, [role=main], #content, .content, .post, .entry-content, body')) {
    const s = score(c) * (c.tagName === 'ARTICLE' ? 1.5 : 1);
    if (s > bs) { bs = s; best = c; }
  }
  if (bs < 200) return null;
  const blocks = [];
  for (const el of best.querySelectorAll('h1,h2,h3,p,li,blockquote,pre,img')) {
    if (el.closest('nav,header nav,footer,aside,form,[aria-hidden=true],[hidden]')) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') { if (el.naturalWidth >= 200 && el.src) blocks.push({ t: 'img', src: el.currentSrc || el.src, text: el.alt || '' }); continue; }
    const text = (el.innerText || '').trim();
    if (!text || (tag === 'p' && text.length < 20)) continue;
    blocks.push({ t: tag, text });
    if (blocks.length >= 600) break;
  }
  return { title: document.title || '', blocks, lang: document.documentElement.lang || '' };
})()`;

const store = new Map();

function clean(raw, url) {
  if (!raw || !Array.isArray(raw.blocks)) return null;
  const types = new Set(['h1', 'h2', 'h3', 'p', 'li', 'blockquote', 'pre', 'img']);
  const blocks = [];
  for (const b of raw.blocks.slice(0, 600)) {
    if (!b || !types.has(b.t)) continue;
    if (b.t === 'img') {
      if (typeof b.src === 'string' && /^https?:\/\//i.test(b.src) && b.src.length <= 2048) blocks.push({ t: 'img', src: b.src, text: String(b.text || '').slice(0, 200) });
    } else if (typeof b.text === 'string') blocks.push({ t: b.t, text: b.text.slice(0, 5000) });
  }
  if (!blocks.length) return null;
  return { title: String(raw.title || '').slice(0, 300), url, blocks };
}

async function openReader(tab) {
  const wc = tab.wc;
  if (!wc || !/^https?:/i.test(tab.url)) throw Object.assign(new Error('Reading mode works on web pages only.'), { expose: true });
  const raw = await wc.executeJavaScript(EXTRACT, true);
  const art = clean(raw, tab.url);
  if (!art) throw Object.assign(new Error('Reading mode couldn\u2019t find an article on this page.'), { expose: true });
  const id = crypto.randomUUID();
  store.set(id, art);
  if (store.size > 20) store.delete(store.keys().next().value);
  tab.loadInternal(`zentro://reader/?id=${id}`);
}

const getArticle = (id) => store.get(id) || null;

module.exports = { openReader, getArticle };
