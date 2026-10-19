'use strict';
(() => {
  const { h, icon, call, toast, Views, fail } = window.M;
  const { on } = window.Z;

  Views.account = async ({ view }) => {
    let A = null; let Pm = null; let V = null; let S = null; let servers = []; let pollTimer = 0; let busy = false;
    const section = (title, ...rows) => h('section', { class: 'section' }, [h('h2', { text: title }), h('div', { class: 'card' }, rows)]);
    const row = (title, desc, ...ctl) => h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: title }), desc ? h('p', { text: desc }) : null]), h('div', { class: 'ctl' }, ctl)]);
    const btn = (text, fn, cls = '') => h('button', { class: `btn ${cls}`.trim(), type: 'button', text, on: { click: fn } });
    const guard = (fn) => async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { fail(e); } busy = false; };

    async function load() {
      [A, Pm, V, S] = await Promise.all([call('account:state'), call('premium:state'), call('vpn:state'), call('settings:get')]);
      servers = [];
      if (Pm.premium && V.serverConfigured) { try { servers = await call('vpn:servers'); } catch { servers = []; } }
      draw();
    }

    function signInForm() {
      const email = h('input', { type: 'text', maxlength: '254', placeholder: 'you@example.com', 'aria-label': 'Email', spellcheck: 'false' });
      const pass = h('input', { type: 'password', maxlength: '128', placeholder: 'Password (8+ characters to sign up)', 'aria-label': 'Password' });
      const go = (m) => guard(async () => { await call(m, { email: email.value.trim(), password: pass.value }); toast(m === 'account:signup' ? 'Account created. Check your inbox to verify your email.' : 'Signed in.'); await load(); });
      return [
        row('Sign in or create an account', 'Your Premium purchase is linked to your account.', email, pass),
        row('', '', btn('Sign in', go('account:signin'), 'btn-primary'), btn('Create account', go('account:signup')),
          btn('Forgot password', guard(async () => { await call('account:reset', { email: email.value.trim() }); toast('If an account exists, a reset link is on its way.'); }), 'btn-quiet')),
        A.googleConfigured ? row('Google', 'Opens your normal web browser to sign in safely.', btn('Continue with Google', guard(async () => { toast('Finish signing in in your web browser.'); await call('account:google'); await load(); }))) : null,
      ];
    }

    function avatarCard() {
      const av = S.settings.avatar;
      const label = S.settings.profile.displayName || A.name || A.email || 'Z';
      const imageUrl = av.image ? `zentro://avatar/current?v=${av.rev}` : null;
      const styles = [['aurora', 'Aurora'], ['pulse', 'Pulse'], ['orbit', 'Orbit'], ['flow', 'Flow'], ['sparkle', 'Sparkle']];
      const picks = h('div', { class: 'avpicks' }, styles.map(([id, name]) => {
        const b = h('button', { class: 'avpick', type: 'button', 'aria-pressed': String(av.style === id), title: name, 'aria-label': `${name} style`, on: { click: guard(async () => { await call('settings:set', { avatar: { style: id } }); }) } }, [window.Z.avatarEl({ style: id, label, size: 44, imageUrl })]);
        return b;
      }));
      return section('Profile picture',
        h('div', { class: 'set avrow' }, [window.Z.avatarEl({ style: av.style, label, size: 76, imageUrl }), h('div', { class: 'tx' }, [h('b', { text: 'Your animated picture' }), h('p', { text: 'Pick an animated style, or upload your own picture. A GIF keeps moving.' })])]),
        h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('b', { text: 'Style' })]), h('div', { class: 'ctl' }, [picks])]),
        row('Your own picture', 'PNG, JPG, WEBP or GIF, up to 8 MB.',
          btn('Upload picture or GIF', guard(async () => { const r = await call('avatar:choose'); if (r) toast('Profile picture updated.'); })),
          av.image ? btn('Remove', guard(async () => { await call('avatar:remove'); }), 'btn-quiet') : null));
    }

    function profileCard() {
      const P = S.settings.profile;
      const name = h('input', { type: 'text', maxlength: '40', value: P.displayName, placeholder: A.name || (A.email ? A.email.split('@')[0] : 'Your name'), 'aria-label': 'Display name' });
      const school = h('input', { type: 'text', maxlength: '40', value: P.schoolName, placeholder: 'School (optional)', 'aria-label': 'School' });
      const grade = h('input', { type: 'text', maxlength: '40', value: P.grade, placeholder: 'Class or year (optional)', 'aria-label': 'Class or year' });
      const saveProfile = guard(async () => { S.settings = await call('settings:set', { profile: { displayName: name.value, schoolName: school.value, grade: grade.value } }); toast('Profile saved.'); draw(); });
      for (const el of [name, school, grade]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveProfile(); });
      return section('Your profile',
        row('Display name', 'Shown in chat and next to your picture. Only you decide it.', name),
        row('School', 'Only stored on this computer. Used on your School Mode page.', school, grade),
        row('', '', btn('Save profile', saveProfile, 'btn-primary'),
          btn('Open School Mode', () => window.M.open('zentro://school/')), btn('Open chat', () => window.M.open('zentro://chat/'))));
    }

    function accountCard() {
      if (!A.configured) return section('Account', row('Accounts are not set up yet', 'The developer has to fill in the Firebase key in src/core/config.js (see SETUP.md).'));
      if (!A.signedIn) return section('Account', ...signInForm());
      return section('Account',
        row(A.email, A.emailVerified ? 'Email verified' : 'Email not verified yet. Premium needs a verified email.',
          !A.emailVerified ? btn('Resend email', guard(async () => { await call('account:resend'); toast('Verification email sent.'); })) : null,
          !A.emailVerified ? btn('I verified it', guard(async () => { await call('account:refresh'); await load(); })) : null,
          btn('Change password', guard(async () => { await call('account:reset', { email: A.email }); toast('A password reset link is on its way to your inbox.'); })),
          btn('Sign out', guard(async () => { await call('account:signout'); await load(); }), 'btn-danger')),
        A.offline ? row('Offline', 'Could not reach the account service. Some features may be unavailable.') : null);
    }

    function premiumCard() {
      const why = { 'signed-out': 'Sign in to buy or use Premium.', 'not-configured': 'The Zentro server is not set up yet (see SETUP.md).', offline: 'Could not check your purchase. Check your connection.', 'email-not-verified': 'Verify your email address first, then press "Check my purchase".', none: 'No purchase found for your account yet.' };
      if (Pm.premium) return section('Zentro Premium', row('Zentro Premium is active', 'Thank you for supporting Zentro. VPN is unlocked.', btn('Refresh', guard(async () => { Pm = await call('premium:refresh'); draw(); }))));
      return section('Zentro Premium',
        row('Get Zentro Premium', 'Unlocks Zentro VPN. You pay securely on Stripe in your web browser.',
          btn('Buy Premium', guard(async () => { await call('premium:buy'); toast('Finish paying in your browser. I will check automatically.'); startPolling(); }), 'btn-primary'),
          btn('Check my purchase', guard(async () => { Pm = await call('premium:refresh'); draw(); toast(Pm.premium ? 'Premium is active!' : 'No purchase found yet.'); }))),
        h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: why[Pm.reason] || 'Premium is not active.' })])]));
    }

    function startPolling() {
      clearInterval(pollTimer);
      let n = 0;
      pollTimer = setInterval(async () => {
        n += 1;
        try { Pm = await call('premium:refresh'); } catch { /* keep trying */ }
        if ((Pm && Pm.premium) || n > 24) { clearInterval(pollTimer); await load(); }
      }, 5000);
    }

    function vpnCard() {
      if (!Pm.premium) return section('Zentro VPN', row('Premium feature', 'Routes this browser\u2019s traffic through a Zentro server. Unlock it with Zentro Premium.'));
      const sel = h('select', { 'aria-label': 'VPN server' }, servers.map((s) => h('option', { value: s.id, text: s.country ? `${s.name} (${s.country})` : s.name })));
      if (V.server) sel.value = V.server.id;
      const sw = h('label', { class: 'switch' }, [h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'VPN' }), h('i')]);
      const cb = sw.querySelector('input');
      cb.checked = V.on; cb.disabled = V.busy || (!V.on && !servers.length);
      cb.addEventListener('change', guard(async () => {
        try { V = await call(cb.checked ? 'vpn:connect' : 'vpn:disconnect', cb.checked ? sel.value : undefined); toast(V.on ? `VPN on: ${V.server.name}` : 'VPN off.'); } catch (e) { cb.checked = !cb.checked; throw e; }
        draw();
      }));
      return section('Zentro VPN',
        row('Use Zentro VPN', V.on ? `Connected to ${V.server.name}. Your websites see the server\u2019s address.` : (servers.length ? 'Off.' : 'No servers available right now.'), sel, sw),
        h('div', { class: 'set' }, [h('div', { class: 'tx' }, [h('p', { text: 'The VPN covers this browser only, not other apps. If the server goes down, pages stop loading instead of falling back to your real connection.' })])]));
    }

    function draw() { view.replaceChildren(profileCard(), avatarCard(), accountCard(), premiumCard(), vpnCard()); }

    try { await load(); } catch (e) { fail(e); }
    for (const ev of ['account-changed', 'premium-changed', 'vpn-changed', 'settings-changed']) on(ev, () => { if (!busy) load().catch(() => {}); });
    window.addEventListener('pagehide', () => clearInterval(pollTimer));
    void icon;
  };
})();
