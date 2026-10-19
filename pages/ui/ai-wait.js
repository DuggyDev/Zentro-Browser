'use strict';
(() => {
  const q = new URLSearchParams(location.search);
  const name = (q.get('name') || 'This assistant').slice(0, 40);
  const until = Number(q.get('until')) || 0;
  document.getElementById('title').textContent = `${name} is taking a break`;
  document.getElementById('text').textContent = `${name} said there were too many sign-in attempts. That limit is on their side, and every new try makes the wait longer. Use another assistant in the meantime.`;
  if (until > Date.now()) document.getElementById('until').textContent = `Zentro tries again after ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The wrench button tries right now.`;
})();
