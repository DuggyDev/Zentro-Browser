'use strict';
(() => {
  const { call } = window.Z;
  const $ = (s) => document.querySelector(s);
  let mode = 'in';
  let st = null;
  let busy = false;

  const say = (text, ok) => { const m = $('#msg'); m.textContent = text || ''; m.className = `msg${ok ? ' ok' : ''}`; };
  const setBusy = (b) => { busy = b; for (const id of ['#submit', '#google', '#forgot', '#skip']) $(id).disabled = b; };
  async function run(fn) {
    if (busy) return;
    say(''); setBusy(true);
    try { await fn(); } catch (e) { say(e.message); }
    setBusy(false);
  }
  function setMode(m) {
    mode = m;
    $('#tab-in').setAttribute('aria-selected', String(m === 'in'));
    $('#tab-up').setAttribute('aria-selected', String(m === 'up'));
    $('#submit').textContent = m === 'in' ? 'Sign in' : 'Create account';
    $('#pw-hint').hidden = m === 'in';
    $('#password').autocomplete = m === 'in' ? 'current-password' : 'new-password';
    say('');
  }
  $('#tab-in').addEventListener('click', () => setMode('in'));
  $('#tab-up').addEventListener('click', () => setMode('up'));

  const creds = () => ({ email: $('#email').value.trim(), password: $('#password').value });
  const done = () => call('account:continue');
  $('#submit').addEventListener('click', () => run(async () => {
    await call(mode === 'in' ? 'account:signin' : 'account:signup', creds());
    if (mode === 'up') say('Account created. Check your inbox to verify your email.', true);
    await done();
  }));
  $('#google').addEventListener('click', () => run(async () => {
    say('Finish signing in in your web browser\u2026', true);
    await call('account:google');
    await done();
  }));
  $('#forgot').addEventListener('click', () => run(async () => {
    await call('account:reset', { email: $('#email').value.trim() });
    say('If an account exists for this email, a reset link is on its way.', true);
  }));
  $('#skip').addEventListener('click', () => run(() => call('account:skip')));
  for (const id of ['#email', '#password']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#submit').click(); });

  call('account:state').then((s) => {
    st = s;
    $('#skip').hidden = !s.allowSkip;
    $('#google').hidden = !s.googleConfigured;
    $('#or').hidden = !s.googleConfigured;
    if (!s.configured) say('Accounts are not set up yet (see SETUP.md).');
  }).catch((e) => say(e.message));
  $('#email').focus();
})();
