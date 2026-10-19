'use strict';
(() => {
  const { call, on } = window.Z;
  const $ = (s) => document.querySelector(s);
  let busy = false;
  call('update:info').then((i) => {
    $('#cur').textContent = i.current || '-';
    $('#new').textContent = i.latest || '-';
    if (i.runtime) {            // shown while browsing: it can wait
      $('#title').textContent = 'A new Zentro is ready';
      $('#quit').textContent = 'Later';
    }
    $('#quit').dataset.runtime = i.runtime ? '1' : '';
  }).catch(() => {});

  on('update-progress', (p) => {
    $('#progress').hidden = false;
    const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
    $('#fill').style.width = `${p.done ? 100 : pct}%`;
    $('#msg').textContent = p.done ? 'Installing\u2026 Zentro restarts by itself.' : `Downloading\u2026 ${pct}%`;
  });

  $('#install').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    $('#install').disabled = true;
    $('#msg').textContent = 'Starting the download\u2026';
    call('update:install').then((started) => {
      if (!started) { busy = false; $('#install').disabled = false; $('#msg').textContent = 'The download page opened in your web browser.'; }
    }).catch((e) => { busy = false; $('#install').disabled = false; $('#progress').hidden = true; $('#msg').textContent = e.message; });
  });
  $('#download').addEventListener('click', () => {
    call('update:download').then(() => { $('#msg').textContent = 'The download page opened in your web browser.'; }).catch((e) => { $('#msg').textContent = e.message; });
  });
  $('#quit').addEventListener('click', () => call($('#quit').dataset.runtime ? 'update:later' : 'app:quit').catch(() => {}));
})();
