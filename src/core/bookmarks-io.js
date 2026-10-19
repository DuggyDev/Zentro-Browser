'use strict';
/** Import / export of the standard Netscape bookmark HTML format (what Chrome, Edge and Firefox use). */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

function exportNetscape({ folders, bookmarks }) {
  const line = (b, pad) => `${pad}<DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.floor((b.addedAt || Date.now()) / 1000)}">${esc(b.title || b.url)}</A>\n`;
  let out = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
  for (const f of folders) {
    out += `    <DT><H3>${esc(f.name)}</H3>\n    <DL><p>\n`;
    for (const b of bookmarks.filter((x) => x.folderId === f.id)) out += line(b, '        ');
    out += '    </DL><p>\n';
  }
  for (const b of bookmarks.filter((x) => !x.folderId || !folders.some((f) => f.id === x.folderId))) out += line(b, '    ');
  return out + '</DL><p>\n';
}

/** @returns {{bookmarks: {title:string,url:string,folder:string|null}[]}} only http(s) links are kept */
function importNetscape(html) {
  const out = [];
  const stack = [];
  let pending = null;
  const re = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DT><A\s+([^>]*)>([\s\S]*?)<\/A>|<DL[^>]*>|<\/DL>/gi;
  let m;
  while ((m = re.exec(String(html).slice(0, 20 * 1024 * 1024)))) {
    const tag = m[0].toLowerCase();
    if (m[1] !== undefined) pending = unesc(m[1]).trim();
    else if (m[2] !== undefined) {
      const href = /HREF\s*=\s*"([^"]*)"/i.exec(m[2]);
      if (!href) continue;
      const url = unesc(href[1]).trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const names = stack.filter(Boolean);
      out.push({ title: unesc(m[3].replace(/<[^>]*>/g, '')).trim().slice(0, 300) || url, url, folder: names.length ? names.join(' / ').slice(0, 80) : null });
    } else if (tag.startsWith('<dl')) { stack.push(pending); pending = null; }
    else if (tag === '</dl>') stack.pop();
  }
  return { bookmarks: out };
}

module.exports = { exportNetscape, importNetscape };
