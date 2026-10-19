'use strict';
(() => {
  const { h, icon, call, toast, Views, form, ibtn, fail } = window.M;
  const { on } = window.Z;

  Views.settings = async ({ view }) => {
    let R = await call('settings:get');
    const save = async (patch) => { try { R.settings = await call('settings:set', patch); draw(); } catch (e) { fail(e); draw(); } };
    const seg = (cur, opts, fn) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), text: l, on: { click: () => fn(v) } })));
    const sw = (val, fn, label) => { const el = h('label', { class: 'switch' }, [h('input', { type: 'checkbox', role: 'switch', 'aria-label': label }), h('i')]); el.querySelector('input').checked = !!val; el.querySelector('input').addEventListener('change', (e) => fn(e.target.checked)); return el; };
    const row = (title, desc, ...ctl) => h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: title }), desc ? h('p', { text: desc }) : null]), h('div', { class: 'ctl' }, ctl)]);
    const section = (id, title, ...rows) => h('section', { class: 'section', id }, [h('h2', { text: title }), h('div', { class: 'card' }, rows)]);

    function draw() {
      const s = R.settings;
      const engineSel = h('select', { 'aria-label': 'Default search engine' }, Object.entries(R.engines).map(([k, n]) => h('option', { value: k, text: n })));
      engineSel.value = s.searchEngine;
      engineSel.addEventListener('change', () => save({ searchEngine: engineSel.value }));
      const home = h('input', { type: 'text', value: s.homepage === 'zentro://newtab/' ? '' : s.homepage, placeholder: 'Zentro new tab page', 'aria-label': 'Homepage address', maxlength: '2048' });
      home.addEventListener('change', () => save({ homepage: home.value.trim() ? (/^[a-z][a-z0-9+.-]*:/i.test(home.value.trim()) ? home.value.trim() : `https://${home.value.trim()}`) : 'zentro://newtab/' }));
      const startup = seg(s.startup, [['restore', 'Restore my tabs'], ['newtab', 'New tab page'], ['homepage', 'Homepage']], (v) => save({ startup: v }));
      const dots = h('div', { class: 'dots' }, [['red', '#e11d2e'], ['ember', '#ff5a1f'], ['rose', '#ff3d7f'], ['steel', '#7f93ad']].map(([k, c]) => { const b = h('button', { class: 'dot', type: 'button', title: k, 'aria-label': `${k} accent`, 'aria-pressed': String(s.accent === k), on: { click: () => save({ accent: k }) } }); b.style.background = c; return b; }));

      // School Mode: sites that stay closed while it is on
      const blockInput = h('input', { type: 'text', placeholder: 'tiktok.com', maxlength: '80', 'aria-label': 'Site to close' });
      const addBlock = () => {
        const host = blockInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (!host || !host.includes('.')) { toast('Type a site like tiktok.com'); return; }
        save({ school: { blocklist: [...new Set([...s.school.blocklist, host])] } });
      };
      blockInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlock(); });
      const chips = h('div', { class: 'chips' }, s.school.blocklist.map((d) => h('span', { class: 'chip-s' }, [d, h('button', { class: 'chip-x', type: 'button', title: `Open ${d} again`, 'aria-label': `Remove ${d}`, on: { click: () => save({ school: { blocklist: s.school.blocklist.filter((x) => x !== d) } }) } }, [icon('close')])])));

      const APPS = [['WhatsApp', 'https://web.whatsapp.com/'], ['Discord', 'https://discord.com/app'], ['Mail', 'https://mail.google.com/'], ['Messenger', 'https://www.messenger.com/'], ['Telegram', 'https://web.telegram.org/'], ['Spotify', 'https://open.spotify.com/']];
      const appButtons = APPS.map(([name, url]) => {
        const has = s.sidebar.items.some((x) => !x.builtin && x.url === url);
        const b = h('button', { class: 'btn app-btn', type: 'button', title: has ? `${name} is in your sidebar` : `Add ${name} to the sidebar`, 'aria-pressed': String(has) }, [window.Z.siteLogo(name, url, 20), h('span', { text: name })]);
        b.disabled = has || s.sidebar.items.length >= 16;
        b.addEventListener('click', () => save({ sidebar: { items: [...s.sidebar.items, { id: `app-${name.toLowerCase()}`, name, url, mode: 'panel', builtin: false }] } }));
        return b;
      });

      // sidebar items
      const items = s.sidebar.items.map((it, i) => h('div', { class: 'set' }, [
        h('div', { class: 'tx' }, [h('b', { text: it.name }), h('p', { text: it.builtin ? 'Built-in page' : it.url })]),
        h('div', { class: 'ctl' }, [seg(it.mode, [['panel', 'Side panel'], ['tab', 'New tab']], (v) => save({ sidebar: { items: s.sidebar.items.map((x) => (x.id === it.id ? { ...x, mode: v } : x)) } })),
          ibtn('trash', `Remove ${it.name}`, () => save({ sidebar: { items: s.sidebar.items.filter((x) => x.id !== it.id) } }), 'danger')])]));
      const addSite = h('button', { class: 'btn', type: 'button', on: { click: async () => {
        const v = await form({ title: 'Add a website to the sidebar', text: 'It opens in a side panel (or a new tab) when you click it. You can add any website; nothing is added for you.', fields: [{ name: 'name', label: 'Name', max: 40 }, { name: 'url', label: 'Address', max: 2048, placeholder: 'https://example.com' }], ok: 'Add' });
        if (!v || !v.name || !v.url) return;
        const url = /^[a-z][a-z0-9+.-]*:/i.test(v.url) ? v.url : `https://${v.url}`;
        save({ sidebar: { items: [...s.sidebar.items, { id: `site-${Date.now().toString(36)}`, name: v.name, url, mode: 'panel', builtin: false }] } });
      } } }, [icon('plus'), h('span', { text: 'Add website' })]);

      // shield exceptions
      const sites = s.shield.siteOff.length ? s.shield.siteOff.map((d) => h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: d }), h('p', { text: 'Shield is off for this site' })]), h('div', { class: 'ctl' }, [h('button', { class: 'btn', type: 'button', text: 'Turn Shield back on', on: { click: () => save({ shield: { siteOff: s.shield.siteOff.filter((x) => x !== d) } }) } })])]))
        : [h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'No exceptions. Use the shield button in the address bar to turn protection off for one site.' })])])];
      const listInfo = h('p', { id: 'list-info', text: 'Loading filter list information\u2026' });
      const updateBtn = h('button', { class: 'btn', type: 'button', text: 'Update filter list', on: { click: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Downloading\u2026';
        try { const r = await call('shield:update-lists'); toast(`Filter list updated: ${r.total.toLocaleString()} domains.`); } catch (err) { fail(err); }
        e.target.disabled = false; e.target.textContent = 'Update filter list'; loadInfo();
      } } });
      async function loadInfo() {
        try {
          const i = await call('shield:info');
          listInfo.textContent = `${i.listSize.toLocaleString()} domains loaded. ${i.updated && i.updated.at ? `Last updated ${new Date(i.updated.at).toLocaleDateString()}.` : 'Using the small list that ships with Zentro Browser.'} Downloaded from pgl.yoyo.org only when you press the button.`;
        } catch { listInfo.textContent = ''; }
      }

      // site permissions
      const permBox = h('div', {});
      async function loadPerms() {
        try {
          const list = await call('permissions:list');
          permBox.replaceChildren(...(list.length ? list.map((p) => h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: p.origin }), h('p', { text: `${p.decision === 'allow' ? 'Allowed to' : 'Blocked from asking to'} ${p.label}` })]), h('div', { class: 'ctl' }, [h('button', { class: 'btn', type: 'button', text: 'Reset', on: { click: () => call('permissions:revoke', { origin: p.origin, permission: p.permission }).then(loadPerms).catch(fail) } })])]))
            : [h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'No saved choices. Websites always ask before using your location, camera, microphone or notifications.' })])])]));
        } catch { /* ignore */ }
      }

      // clear data
      const range = h('select', { 'aria-label': 'Time range' }, [['hour', 'Last hour'], ['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time']].map(([v, l]) => h('option', { value: v, text: l })));
      range.value = 'all';
      const checks = {};
      const chk = (k, label, on0) => { const i = h('input', { type: 'checkbox' }); i.checked = on0; checks[k] = i; return h('label', {}, [i, h('span', { text: label })]); };
      const clearBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Clear data', on: { click: async () => {
        const items = Object.fromEntries(Object.entries(checks).map(([k, i]) => [k, i.checked]));
        if (!Object.values(items).some(Boolean)) { toast('Choose something to clear.'); return; }
        const ok = await form({ title: 'Clear browsing data?', text: 'This cannot be undone.', ok: 'Clear', danger: true });
        if (!ok) return;
        try { await call('data:clear', { range: range.value, items }); toast('Browsing data cleared.'); } catch (err) { fail(err); }
      } } });

      const aiName = h('input', { type: 'text', maxlength: '30', placeholder: 'Name', 'aria-label': 'Name of your AI', value: s.ai.customName });
      const aiUrl = h('input', { type: 'text', maxlength: '2000', placeholder: 'https://\u2026', 'aria-label': 'Link of your AI', spellcheck: 'false', value: s.ai.customUrl });
      const aiSave = h('button', { class: 'btn', type: 'button', text: 'Save', on: { click: () => save({ ai: { customName: aiName.value.trim(), customUrl: aiUrl.value.trim() } }) } });
      const aiProviders = [['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'], ['grok', 'Grok'], ...(s.ai.customUrl ? [['custom', s.ai.customName || 'Custom']] : [])];

      view.replaceChildren(
        section('general', 'General',
          row('Search engine', 'Used in the address bar and on the new tab page.', engineSel),
          row('On startup', 'What opens when you start Zentro Browser.', startup),
          row('Homepage', 'Opens with the Home button. Leave empty for the Zentro new tab page.', home)),
        section('appearance', 'Appearance',
          row('Theme', 'Dark is the default.', seg(s.theme, [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], (v) => save({ theme: v }))),
          row('Dark mode for websites', 'Darkens websites that do not have a dark theme of their own (Google, news sites...). Sites with their own dark theme use it automatically. Takes effect after a restart.',
            sw(s.forceDark, (v) => save({ forceDark: v }), 'Dark mode for websites'),
            s.forceDark !== R.forceDarkRunning ? h('button', { class: 'btn btn-primary', type: 'button', text: 'Restart now', on: { click: () => call('app:restart').catch(fail) } }) : null),
          row('New tab background', 'Upload your own pictures, then pick one with the Customize button on the new tab page (or drop an image onto it).', h('button', { class: 'btn', type: 'button', text: 'Upload images\u2026', on: { click: () => call('wallpapers:add').then((ids) => { if (ids.length) toast(`Added ${ids.length} background${ids.length === 1 ? '' : 's'}. It is now your new tab background.`); }).catch(fail) } })),
          row('Sounds', 'A soft click when you press buttons and a pop when a tab opens.', sw(s.sounds.enabled, (x) => save({ sounds: { enabled: x } }), 'Sounds'), seg(String([20, 40, 70].reduce((a, b) => (Math.abs(b - s.sounds.volume) < Math.abs(a - s.sounds.volume) ? b : a))), [['20', 'Low'], ['40', 'Medium'], ['70', 'High']], (v) => { save({ sounds: { volume: Number(v) } }); window.Z.sound('click'); })),
          row('Animations', 'Smooth movement across the browser, new tab page and profile picture. Turn off for a calmer, faster feel.', sw(s.animations, (x) => save({ animations: x }), 'Animations')),
          row('Accent colour', '', dots),
          row('Tab position', 'Put your tabs at the top, left, right or bottom. You can also change it from the menu.', seg(s.tabLayout, [['horizontal', 'Top'], ['vertical', 'Left'], ['right', 'Right'], ['bottom', 'Bottom']], (v) => save({ tabLayout: v })))),
        section('school', 'School Mode',
          row('School Mode', 'Keeps distracting sites closed while you study. Your homework, timer and grades are on the School Mode page.', sw(s.school.enabled, (v) => save({ school: { enabled: v } }), 'School Mode'), h('button', { class: 'btn', type: 'button', text: 'Open School Mode', on: { click: () => window.M.open('zentro://school/') } })),
          row('Close distracting sites', 'Sites in the list below (and their pages) do not open while School Mode is on.', sw(s.school.blockDistractions, (v) => save({ school: { blockDistractions: v } }), 'Close distracting sites')),
          h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: 'Closed sites' }), chips])]),
          row('Add a site', '', blockInput, h('button', { class: 'btn btn-primary', type: 'button', text: 'Add', on: { click: addBlock } }), h('button', { class: 'btn btn-quiet', type: 'button', text: 'Reset list', on: { click: () => save({ school: { blocklist: R.defaultBlocklist } }) } }))),
        section('ai', 'AI assistant',
          row('Show the AI button', 'A floating assistant over any page (Ctrl+Shift+A). It opens the AI\u2019s own website, so you sign in there with your own account.', sw(s.ai.enabled, (x) => save({ ai: { enabled: x } }), 'AI assistant')),
          row('Opens first', 'Switch between assistants any time inside the panel.', seg(s.ai.provider, aiProviders, (x) => save({ ai: { provider: x } }))),
          row('Add your own AI', 'Any AI website (a link starting with https://) becomes a fifth assistant.', aiName, aiUrl, aiSave),
          h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'Zentro never sends anything to an AI by itself. The Share button in the panel puts the page text, your selection or a screenshot in the AI\u2019s message box when you press it, and you press Send. Whatever you share goes to that AI company under their privacy rules.' })])])),
        section('sidebar', 'Sidebar',
          h('div', { class: 'set stack' }, [h('div', { class: 'tx' }, [h('b', { text: 'Add apps' }), h('p', { text: 'One click and the app sits in your sidebar. It opens in a small side panel next to the page you are on.' })]), h('div', { class: 'ctl apps' }, appButtons)]),
          row('Show sidebar', 'A strip of shortcuts on the left. Keyboard: Ctrl+Alt+1 to 9.', sw(s.sidebar.enabled, (v) => save({ sidebar: { enabled: v } }), 'Show sidebar')),
          row('Size', 'Compact shows icons only.', seg(s.sidebar.mode, [['compact', 'Compact'], ['expanded', 'Expanded']], (v) => save({ sidebar: { mode: v } }))),
          ...items, h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'Add any website you use often. Nothing is bundled.' })]), h('div', { class: 'ctl' }, [addSite])])),
        section('performance', 'Tabs and performance',
          row('Put unused tabs to sleep', 'Frees memory by unloading background tabs. A sleeping tab reloads when you open it. Tabs playing audio are never put to sleep.', sw(s.sleep.enabled, (v) => save({ sleep: { enabled: v } }), 'Sleeping tabs')),
          row('Sleep after', '', (() => { const sel = h('select', { 'aria-label': 'Sleep after' }, [[10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']].map(([v, l]) => h('option', { value: String(v), text: l }))); sel.value = String(s.sleep.minutes); if (!sel.value) sel.value = '30'; sel.addEventListener('change', () => save({ sleep: { minutes: Number(sel.value) } })); return sel; })())),
        section('downloads', 'Downloads',
          row('Save files to', R.settings.downloadDir || R.defaultDownloadDir, h('button', { class: 'btn', type: 'button', text: 'Change\u2026', on: { click: () => call('settings:choose-download-dir').then((r) => { if (r) { R.settings = r; draw(); } }).catch(fail) } }),
            s.downloadDir ? h('button', { class: 'btn', type: 'button', text: 'Use default', on: { click: () => save({ downloadDir: null }) } }) : null),
          row('Notifications', 'Show a Windows notification when a download finishes.', sw(s.notifications, (v) => save({ notifications: v }), 'Notifications'))),
        section('shield', 'Zentro Shield',
          row('Zentro Shield', 'Master switch for tracker blocking and cookie controls.', sw(s.shield.enabled, (v) => save({ shield: { enabled: v } }), 'Zentro Shield')),
          row('Block ads and trackers', 'Blocks third-party requests to domains on the filter list. It does not block every ad or tracker.', sw(s.shield.blockTrackers, (v) => save({ shield: { blockTrackers: v } }), 'Block ads and trackers')),
          row('Third-party cookies', 'Cookies set by sites other than the one you are visiting. Blocking can break some sign-in flows.', seg(s.shield.thirdPartyCookies, [['allow', 'Allow'], ['block', 'Block']], (v) => save({ shield: { thirdPartyCookies: v } }))),
          row('Always block them in private windows', '', sw(s.shield.blockThirdPartyInPrivate, (v) => save({ shield: { blockThirdPartyInPrivate: v } }), 'Block in private windows')),
          row('HTTPS first', 'Tries the secure version of a site first when you type an http:// address. If it is unavailable, the page loads unencrypted and the address bar shows a warning.', sw(s.shield.httpsFirst, (v) => save({ shield: { httpsFirst: v } }), 'HTTPS first')),
          h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: 'Filter list' }), listInfo]), h('div', { class: 'ctl' }, [updateBtn])]),
          h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: 'Per-site exceptions' })])]), ...sites),
        section('permissions', 'Site permissions', permBox),
        section('privacy', 'Clear browsing data',
          h('div', { class: 'checks' }, [h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: 'Time range' })]), h('div', { class: 'ctl' }, [range])]),
            chk('history', 'Browsing history', true), chk('downloads', 'Download list (files are not deleted)', true), chk('cookies', 'Cookies and logins', true), chk('cache', 'Cached images and files', true), chk('siteData', 'Other site data (local storage, offline data)', false),
            h('div', { class: 'ctl' }, [clearBtn])]),
          h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'Cookies, cache and site data are cleared for all time. The time range applies to history only. Private windows never save anything.' })])])),
        section('about', 'About and reset',
          row('Zentro Browser', `Version ${R.version}, Chromium ${R.chromium}, Electron ${R.electron}. Browsing data stays on this computer.`),
          row(`Made by ${R.team || 'Zentro dev team'}`),
          row('Not included', 'No password manager, no sync, no cryptocurrency features. The VPN (Zentro Premium) covers this browser only. Zentro does not claim to make you anonymous.'),
          row('Restore default settings', 'Resets every setting on this page. Bookmarks, history and collections are kept.', h('button', { class: 'btn btn-danger', type: 'button', text: 'Restore defaults', on: { click: async () => { const ok = await form({ title: 'Restore default settings?', text: 'Your bookmarks, history and collections are not affected.', ok: 'Restore', danger: true }); if (ok) { R.settings = await call('settings:reset').catch((e) => { fail(e); return R.settings; }); draw(); toast('Default settings restored.'); } } } }))),
      );
      loadInfo(); loadPerms();
    }

    draw();
    on('settings-changed', async () => { try { R = await call('settings:get'); draw(); } catch { /* ignore */ } });
    on('permissions-changed', () => { if (document.getElementById('view')) draw(); });
    if (location.hash) setTimeout(() => { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }, 50);
  };
})();
