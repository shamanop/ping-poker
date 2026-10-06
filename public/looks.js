'use strict';
// Table looks: the room + table painting a table is drawn in (public/images/ui/looks/<id>/, mapped in looks.css via #game-screen[data-look]).
// PingLooks.apply(id)  sets data-look on #game-screen once both images are loaded (no flash of the basement); cached or basement = immediate.
// PingLooks.picker({ value, onPick, id })  the row of seven thumbnails used by the create form and the host drawer.
(function () {
  const LOOKS = [['basement', 'Basement'], ['yacht', 'Yacht'], ['miami', 'Miami'], ['redroom', 'Red Room'], ['ranch', 'Ranch'], ['vault', 'Vault'], ['saucer', 'Saucer']];
  const IDS = LOOKS.map((l) => l[0]);
  const dir = (id) => (id === 'basement' ? 'images/ui/' : 'images/ui/looks/' + id + '/');
  const urls = (id) => [dir(id) + 'room.jpg', dir(id) + 'table.png'];
  const loaded = new Set(['basement']);
  const loading = {};
  let want = 'basement';

  const known = (id) => (IDS.includes(id) ? id : 'basement');
  const nameOf = (id) => (LOOKS.find((l) => l[0] === id) || LOOKS[0])[1];
  function preload(id) {
    if (loaded.has(id)) return Promise.resolve();
    if (loading[id]) return loading[id];
    return (loading[id] = Promise.all(urls(id).map((u) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = u; })))
      .then(() => { loaded.add(id); delete loading[id]; }));
  }
  function swap(scr, id) { scr.setAttribute('data-look', id); scr.classList.remove('look-wait'); }
  function apply(raw) {
    const id = known(raw), scr = document.getElementById('game-screen');
    want = id;
    if (!scr || scr.getAttribute('data-look') === id) return;
    if (loaded.has(id)) { swap(scr, id); return; }
    // not cached yet: keep what is on screen (or a plain dark room while the screen is still hidden) until both images are in
    if (!scr.classList.contains('active')) scr.classList.add('look-wait');
    preload(id).then(() => { if (want === id) swap(scr, id); });
  }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (v != null) e.setAttribute(k, v); }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  function picker({ value, onPick, id } = {}) {
    const cur = known(value), box = h('div', { class: 'look-pick', id: id || null, role: 'radiogroup', 'aria-label': 'Table look' });
    for (const [lid, name] of LOOKS) {
      const on = lid === cur;
      const b = h('button', { type: 'button', class: 'look-opt' + (on ? ' on' : ''), 'data-look': lid, role: 'radio', 'aria-checked': on ? 'true' : 'false', title: name,
        onclick: () => { for (const x of box.children) { const s = x === b; x.classList.toggle('on', s); x.setAttribute('aria-checked', s ? 'true' : 'false'); } preload(lid); if (onPick) onPick(lid); } },
        h('img', { src: lid === 'basement' ? 'images/ui/looks/basement/thumb.jpg' : 'images/ui/looks/' + lid + '/thumb.jpg', alt: '', width: 312, height: 208, loading: 'lazy', draggable: 'false' }),
        h('span', null, name));
      box.append(b);
    }
    return box;
  }
  window.PingLooks = { LOOKS, IDS, nameOf, apply, preload, picker, known };
})();
