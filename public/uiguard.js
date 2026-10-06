// UI guards shared by every screen (ui/REPORT defects 4, 5):
//  - PingUI.isOverlayOpen(): one answer to "is something modal on top of the table?" for every hotkey handler.
//  - native context menu suppressed on game surfaces only; images are never draggable.
(function () {
  'use strict';

  // Anything that sits above the table and owns the keyboard while it is open.
  const OVERLAYS = [
    '#bank-panel.open', '#host-drawer', '.adm-veil.on', '.sh-win.open.focused',
    '[role="dialog"]', '.modal-back:not(.hidden)', '.pj-modal', '#ctx-menu', '.lb-scrim'
  ].join(',');

  function isOverlayOpen() {
    return !!document.querySelector(OVERLAYS);
  }

  // Native menu stays on text and links; suppressed on the felt, seats, cards, avatars, chips, logo and every image.
  const KEEP_NATIVE = 'input, textarea, select, [contenteditable="true"], #chat-messages .chat-text, .wp-invite-link, #wp-invite, #room-code, #room-code-btn, a[href]';
  const GAME_SURFACE = '.seat, .seat-layer, #table-box, .table-box, .table-mark, .card, .hero-cards, .community, .seat-av, .bet-layer, .pot-row, .chip, .bet, .g-brand, .lockup-vp, .emote-strip, .sticker-grid, .throw-grid, img';

  document.addEventListener('contextmenu', e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || t.closest(KEEP_NATIVE)) return;
    if (t.closest(GAME_SURFACE)) e.preventDefault();
  }, true);

  // Stop native image drag (belt and braces with -webkit-user-drag:none in CSS).
  document.addEventListener('dragstart', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG') e.preventDefault();
  }, true);

  function undrag(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'IMG') root.setAttribute('draggable', 'false');
    const imgs = root.querySelectorAll ? root.querySelectorAll('img:not([draggable="false"])') : [];
    for (let i = 0; i < imgs.length; i++) imgs[i].setAttribute('draggable', 'false');
  }
  function watchImages() {
    undrag(document.documentElement);
    new MutationObserver(list => {
      for (const m of list) m.addedNodes.forEach(undrag);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchImages);
  else watchImages();

  // Server `error` events are {message, code, min?, max?, have?, need?}: the message carries no digits (the server never formats money);
  // the numbers are added here with Money in the viewer's mode. Unknown codes fall back to the message alone.
  function errorText(e, mode) {
    const msg = (e && e.message) || 'Something went wrong';
    const M = window.Money; if (!e || !M || !mode) return msg;
    const f = v => M.format(v, mode), has = v => Number.isFinite(v);
    const parts = [];
    if (has(e.min) && has(e.max)) parts.push(f(e.min) + ' to ' + f(e.max));
    else if (has(e.min)) parts.push('at least ' + f(e.min));
    else if (has(e.max)) parts.push('at most ' + f(e.max));
    if (has(e.have)) parts.push('you have ' + f(e.have));
    if (has(e.need)) parts.push('you need ' + f(e.need));
    return parts.length ? msg + ' (' + parts.join(', ') + ')' : msg;
  }

  window.PingUI = { isOverlayOpen, errorText };
})();
