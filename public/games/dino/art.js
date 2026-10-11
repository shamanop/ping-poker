/* DINO art manifest + preloader. window.DinoArt = { slots, has(key), url(key), ready, base }.
   Reads art/manifest.json next to index.html (override: ?artbase=/some/dir/, disable: ?art=0). Missing manifest, missing key or a file that fails
   to load => that slot stays a CSS/SVG placeholder. Never throws. Contract for the art agent: _dino/ASSET-SLOTS.md */
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search);
  var off = Q.get('art') === '0';
  var base = Q.get('artbase') || 'art/';
  if (!/^[\w\-./]+$/.test(base) || base.indexOf('..') >= 0) base = 'art/';
  if (base.slice(-1) !== '/') base += '/';
  base = new URL(base, document.baseURI).href;

  var slots = {};
  var FILE_RE = /^[\w\-./]+\.(png|webp|jpe?g|avif|svg)$/i;
  var TIERS = ['nice', 'great', 'big', 'huge', 'mega', 'epic'];
  var root = document.documentElement;

  function has(key) { return Object.prototype.hasOwnProperty.call(slots, key); }
  function url(key) { return has(key) ? slots[key] : null; }

  function loadImg(src) {
    return new Promise(function (resolve) {
      var im = new Image(), done = false;
      function fin(ok) { if (done) return; done = true; resolve(ok); }
      im.onload = function () { if (im.decode) im.decode().then(function () { fin(true); }, function () { fin(true); }); else fin(true); };
      im.onerror = function () { fin(false); };
      im.src = src;
      setTimeout(function () { fin(false); }, 8000);
    });
  }

  function apply() {
    Object.keys(slots).forEach(function (k) {
      root.style.setProperty('--art-' + k, 'url("' + slots[k] + '")');
      root.classList.add('art-' + k);
    });
    root.classList.add('art-ready');
    if (has('bg_portrait') || has('bg_landscape')) root.classList.add('art-bg');
    if (has('bg_free_portrait') || has('bg_free_landscape')) root.classList.add('art-bg-free');
    try { if (window.DinoSymbols && window.DinoSymbols.refresh) window.DinoSymbols.refresh(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('dinoart', { detail: { slots: slots } })); } catch (e) {}
  }

  var ready = off ? Promise.resolve(slots) : fetch(base + 'manifest.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (m) {
      if (!m || typeof m !== 'object' || !m.slots || typeof m.slots !== 'object') return slots;
      var v = m.v != null ? '?v=' + encodeURIComponent(String(m.v)) : '';
      var keys = Object.keys(m.slots).filter(function (k) { return /^[\w]+$/.test(k) && typeof m.slots[k] === 'string' && FILE_RE.test(m.slots[k]) && m.slots[k].indexOf('..') < 0; });
      return Promise.all(keys.map(function (k) {
        var src = new URL(m.slots[k], base).href + v;
        return loadImg(src).then(function (ok) { if (ok) slots[k] = src; });
      })).then(function () { return slots; });
    })
    .then(function () { apply(); return slots; });

  // ---- tag the fx.js overlay panels so theme.css can skin them (fx.js is not edited) ----
  function tierOf(txt) { var w = String(txt || '').trim().split(/\s+/)[0].toLowerCase(); return TIERS.indexOf(w) >= 0 ? w : ''; }
  function tag(panel) {
    if (!panel || !panel.classList || !panel.classList.contains('dfx-panel')) return;
    var kind = '';
    if (panel.querySelector('.dfx-tier')) kind = 'bigwin';
    else {
      var l = panel.querySelector('.dfx-lbl'), t = l ? l.textContent.toUpperCase() : '';
      kind = t.indexOf('FREE') >= 0 ? 'fsintro' : t.indexOf('WON') >= 0 ? 'fsoutro' : '';
    }
    if (!kind) return;
    panel.setAttribute('data-kind', kind);
    if (kind !== 'bigwin' && has('panel_' + (kind === 'fsintro' ? 'fs_intro' : 'fs_outro'))) panel.classList.add('th-art');
    var stage = document.getElementById('stage'); if (stage) stage.classList.add('th-celebrate');
    var tierEl = panel.querySelector('.dfx-tier');
    if (tierEl) tagTier(tierEl);
  }
  function tagTier(tierEl) {
    var t = tierOf(tierEl.textContent);
    if (t && has('bw_' + t)) { tierEl.setAttribute('data-tier', t); tierEl.classList.add('th-art'); }
    else { tierEl.removeAttribute('data-tier'); tierEl.classList.remove('th-art'); }
  }
  function watchOverlay(ov) {
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList') {
          Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) tag(n); });
          if (m.target.classList && m.target.classList.contains('dfx-tier')) tagTier(m.target);
        } else if (m.type === 'characterData' && m.target.parentNode && m.target.parentNode.classList && m.target.parentNode.classList.contains('dfx-tier')) tagTier(m.target.parentNode);
      });
      if (!ov.querySelector('.dfx-panel')) { var s = document.getElementById('stage'); if (s) s.classList.remove('th-celebrate'); }
    });
    mo.observe(ov, { childList: true, subtree: true, characterData: true });
  }
  function boot() {
    var stage = document.getElementById('stage'); if (!stage) return;
    var seen = null;
    function look() { var ov = stage.querySelector('.dfx-ov'); if (ov && ov !== seen) { seen = ov; watchOverlay(ov); } }
    new MutationObserver(look).observe(stage, { childList: true });
    look();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.DinoArt = { slots: slots, has: has, url: url, ready: ready, base: base };
})();
