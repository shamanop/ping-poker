/* DINO mascot poses. window.DinoMascot = { set(pose, {holdMs}), pose, shown }. Poses: idle | celebrate | shock | dance.
   Missing PNG falls back (dance->celebrate->idle, shock->idle, celebrate->idle); with no art at all the SVG placeholder
   plays a CSS motion. The stage class th-celebrate (set by art.js while a big-win/FS panel is open) shows celebrate
   unless a pose was set explicitly. Contract: _dino/ASSET-SLOTS.md */
(function () {
  'use strict';
  var POSES = ['idle', 'celebrate', 'shock', 'dance'];
  var CHAIN = { idle: ['idle'], celebrate: ['celebrate', 'idle'], shock: ['shock', 'idle'], dance: ['dance', 'celebrate', 'idle'] };
  var manual = 'idle', timer = 0, el = null, layers = {};

  function has(k) { return !!(window.DinoArt && window.DinoArt.has('mascot_' + k)); }
  function stageCelebrating() { var s = document.getElementById('stage'); return !!(s && s.classList.contains('th-celebrate')); }
  function wanted() { return manual !== 'idle' ? manual : (stageCelebrating() ? 'celebrate' : 'idle'); }
  function resolve(p) { var c = CHAIN[p]; for (var i = 0; i < c.length; i++) if (has(c[i])) return c[i]; return null; }

  function apply() {
    if (!el) return;
    var p = wanted(), r = resolve(p);
    POSES.forEach(function (k) { if (layers[k]) layers[k].classList.toggle('on', k === r); });
    el.setAttribute('data-art', r ? '1' : '0');
    el.setAttribute('data-fb', r === p ? '0' : '1');
    if (el.getAttribute('data-pose') !== p) { el.removeAttribute('data-pose'); void el.offsetWidth; el.setAttribute('data-pose', p); }
    api.shown = r || 'placeholder';
  }

  function set(pose, o) {
    pose = POSES.indexOf(pose) >= 0 ? pose : 'idle';
    clearTimeout(timer); timer = 0;
    manual = pose;
    apply();
    var ms = o && +o.holdMs;
    if (pose !== 'idle' && ms > 0) timer = setTimeout(function () { timer = 0; manual = 'idle'; apply(); }, ms);
  }

  var api = { set: set, shown: 'placeholder' };
  Object.defineProperty(api, 'pose', { get: wanted, enumerable: true });
  window.DinoMascot = api;

  function boot() {
    el = document.querySelector('.th-mascot'); if (!el) return;
    POSES.forEach(function (k) { layers[k] = el.querySelector('.p-' + k); });
    var stage = document.getElementById('stage');
    if (stage) new MutationObserver(apply).observe(stage, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('dinoart', apply);
    apply();
    if (window.DinoArt && window.DinoArt.ready) window.DinoArt.ready.then(apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
