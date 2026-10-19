'use strict';
(() => {
  const { call } = window.Z;
  const q = new URLSearchParams(location.search);
  const code = Number(q.get('code'));
  const url = q.get('url') || '';
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const isCert = code <= -200 && code >= -299;
  const KIND = {
    '-105': ['We can\u2019t find that site', `There is no server at \u201C${host}\u201D.`, ['Check the address for typing mistakes.', 'Check your internet connection.']],
    '-106': ['You\u2019re offline', 'Zentro Browser can\u2019t reach the internet.', ['Check your network cable or Wi-Fi.', 'Restart your router if other devices are offline too.']],
    '-102': ['The site refused the connection', `\u201C${host}\u201D is not accepting connections.`, ['The site may be down. Try again later.']],
    '-118': ['The site took too long to respond', `\u201C${host}\u201D did not answer in time.`, ['Try again in a moment.', 'Check your internet connection.']],
    '-101': ['The connection was reset', 'The connection to the site was interrupted.', ['Try again.']],
    '-109': ['The address can\u2019t be reached', 'The network address is not reachable.', ['Check the address and your network.']],
    '-20': ['Closed by School Mode', `\u201C${host}\u201D is closed while School Mode is on.`, ['Finish your work first, then turn School Mode off in Settings.', 'You can change which sites are closed in Settings > School Mode.']],
    '-1000': ['This page stopped working', q.get('desc') || 'The page crashed.', ['Reload the page to try again.']],
  };
  let [title, text, tips] = KIND[String(code)] || [isCert ? 'Your connection is not private' : 'This page can\u2019t be opened', isCert ? `\u201C${host}\u201D has a security certificate that Zentro Browser does not trust, so the page was not loaded.` : (q.get('desc') || 'Something went wrong while loading the page.'), isCert ? ['The site may be misconfigured, or someone may be intercepting your connection.', 'Zentro Browser does not offer a way to bypass this warning.'] : ['Try again.']];
  document.getElementById('title').textContent = title;
  document.getElementById('text').textContent = text;
  document.getElementById('addr').textContent = url;
  document.getElementById('addr').hidden = !url;
  document.getElementById('tips').replaceChildren(...tips.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  document.getElementById('code').textContent = `Error ${code}${q.get('desc') ? ': ' + q.get('desc') : ''}`;
  document.title = title;
  const retry = document.getElementById('retry');
  retry.hidden = !/^https?:\/\//i.test(url);
  retry.addEventListener('click', () => call('nav:open', { text: url }).catch(() => {}));
})();
