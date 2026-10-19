'use strict';
/** The tab list when the tabs sit at the bottom or on the right side of the window. */
(() => {
  const { icon, call, on } = window.Z;
  const $ = (s) => document.querySelector(s);
  const swallow = () => {};
  $('#hnew').append(icon('plus'));
  $('#vnew').append(icon('plus'));
  $('#hnew').addEventListener('click', () => call('tab:new').catch(swallow));
  $('#vnew').addEventListener('click', () => call('tab:new').catch(swallow));

  function render(S) {
    document.documentElement.dataset.accent = S.accent;
    const pos = S.layout.pos;
    $('#hstrip').hidden = pos !== 'bottom';
    $('#vtabs').hidden = pos !== 'right';
    if (pos === 'bottom') window.ZTabs.render($('#htabs'), S.tabs);
    else if (pos === 'right') window.ZTabs.render($('#vlist'), S.tabs);
  }
  on('state', render);
  call('ui:state').then(render).catch(swallow);
})();
