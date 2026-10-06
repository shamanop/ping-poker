/* Lobby: sign-in, lobby, create table, share, join/buy-in, host drawer, settle-up. Exposes window.Lobby. */
(() => {
'use strict';

// ── tiny DOM helper ───────────────────────────────────────────────
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  if (a) for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value' || k === 'disabled' || k === 'checked') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else e.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return e;
}
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── state ─────────────────────────────────────────────────────────
const S = {
  user: null, profile: null, wallet: null, view: '', arg: null,
  tables: [], mine: [], net: {}, board: [], info: {}, cur: null, night: null,
  deep: null, pendingJoin: null, resumeBusy: false, lockUntil: 0, onError: null, booted: false,
};
let root = null, topEl = null, mainEl = null, sock = null, pollT = null, lockT = null, hostDrawer = null, hostBtn = null;
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

// ── money helpers ─────────────────────────────────────────────────
// display and typed amounts share one mode per unit, so whatever a box shows parses back to the same value
function modeFor(unit) { return window.Money.modeFor(window.Money.pref, unit); }
function fm(u, unit, o) {
  if (u == null || Number.isNaN(u)) return '-';
  return window.Money.format(u, modeFor(unit), o);
}
function amtText(v, unit) { return window.Money.plain(v, modeFor(unit)); }
function parseAmt(text, unit) { const r = window.Money.parse(text, modeFor(unit)); return r.ok ? r.units : null; }
function ladder(unit, min, max, extra = []) {
  const set = new Set([min, max, ...extra.filter((v) => v >= min && v <= max)]);
  const N = 60, lo = Math.max(1, min);
  for (let i = 1; i < N; i++) {
    const raw = lo * Math.pow(Math.max(max, lo) / lo, i / N);
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
    let v = Math.round(raw / p) * p;
    if (v >= 100) v = Math.round(v / 100) * 100;
    if (v > min && v < max) set.add(v);
  }
  return [...set].sort((a, b) => a - b);
}
const nearIdx = (vals, v) => { let bi = 0, bd = Infinity; vals.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; bi = i; } }); return bi; };
const unitOf = (mode) => (mode === 'chips' ? 'chips' : 'cents');
const modeLabel = (m) => ({ play: 'Play $', chips: 'Chips' }[m] || m);
const modeNote = (m) => ({ play: 'Buy-ins come out of your Play $ balance and cash back into it when you stand up.', chips: 'Chips come from your bank balance.' }[m] || '');
const avSrc = (e) => (e && e.pic) || avUrl(e && e.avatar);
const avUrl = (a) => { let s = String(a ?? 'a01'); if (/^\d+$/.test(s)) s = 'a' + s.padStart(2, '0'); s = s.replace(/\.png$/, ''); return 'images/avatars/' + s + '.png'; };
const code6 = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const tHost = (t) => (t && (t.hostKey || (t.host && t.host.key))) || '';
const tId = (t) => t && (t.id || t.tableId);
const isAdmin = () => !!(S.user && (S.user.isAdmin || S.user.admin || S.user.key === 'chris'));
const myKey = () => S.user && S.user.key;
function toast(msg) {
  document.querySelectorAll('.lb-toast').forEach((n) => n.remove());
  const t = h('div', { class: 'lb-toast panel panel--toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200);
}
function copy(text, what) {
  const done = () => toast(what + ' copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } catch {} ta.remove(); done();
}

// ── socket ────────────────────────────────────────────────────────
function getSock() {
  if (sock) return sock;
  sock = window.PingSocket || (window.io ? (window.PingSocket = window.io()) : null);
  return sock;
}
function emit(ev, payload) { const s = getSock(); if (s) s.emit(ev, payload || {}); }

// ── session ───────────────────────────────────────────────────────
function loadSession() { try { return JSON.parse(LS.get('ping.session') || 'null'); } catch { return null; } }
function saveSession(key, token) { LS.set('ping.session', JSON.stringify({ key, token })); }
function clearSession() { LS.del('ping.session'); LS.del('ping.table'); }
function tryResume() {
  const ses = loadSession();
  if (!ses || !ses.key || !ses.token) return false;
  S.resumeBusy = true; emit('auth_resume', { key: ses.key, token: ses.token }); return true;
}

// ── root + chrome ─────────────────────────────────────────────────
function ensureRoot() {
  if (root) return root;
  root = $('lobby-root') || h('div', { id: 'lobby-root', class: 'lb-root' }, '');
  if (!root.parentNode) document.body.append(root);
  topEl = h('div', { class: 'lb-top' }); mainEl = h('div', { class: 'lb-body', style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
  root.append(topEl, mainEl);
  return root;
}
function renderTop() {
  if (!topEl) return;
  const sw = S.view === 'signin' || !S.user || !!window.Shell;
  topEl.style.display = sw ? 'none' : '';
  if (sw) return;
  const p = S.profile, u = S.user;
  const net = p && p.netCents != null ? 'Net ' + fm(p.netCents, 'cents', { signed: true }) : '';
  const play = !window.Shell && S.wallet && S.wallet.play != null ? 'Play ' + fm(S.wallet.play, 'cents') : '';
  const cls = p && p.netCents > 0 ? 'up' : p && p.netCents < 0 ? 'down' : '';
  topEl.replaceChildren(
    h('div', { class: 'lb-brand' }, h('img', { src: 'images/ui/vp-mark.png', alt: '' }), h('span', null, 'THE ', h('em', null, 'PING'))),
    h('span', { 'data-money-toggle': '' }),
    h('button', { class: 'lb-acct', id: 'lb-acct', style: 'background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer', onclick: openProfile, title: 'Profile' },
      h('img', { src: avSrc(u), alt: '' }),
      h('div', null, h('div', { class: 'nm' }, u.display || u.key), h('div', { class: 'nt' }, h('span', { class: cls }, net), net && play ? '  /  ' : '', play))),
    h('button', { class: 'btn btn--danger btn--sm', id: 'lb-signout', onclick: signOut }, 'Sign out'));
  mountToggles();
  renderAchHint();
}
function mountToggles() {
  if (!window.Money || !window.Money.toggleEl) return;
  document.querySelectorAll('[data-money-toggle]').forEach((slot) => { if (!slot.firstChild) slot.append(window.Money.toggleEl(slot.dataset.unit || 'cents')); });
}
function signOut() { emit('auth_logout', {}); }
function setMain(node) { ensureRoot(); mainEl.replaceChildren(node); }
function scrollWrap(...kids) { return h('div', { class: 'lb-main' }, ...kids); }

// ── routing ───────────────────────────────────────────────────────
let hashLock = false;
function setHash(v) { hashLock = true; try { if (location.hash !== v) location.hash = v; } finally { setTimeout(() => { hashLock = false; }, 0); } }
function show(name, arg) {
  ensureRoot(); clearInterval(pollT); pollT = null;
  closeModal();
  if (name !== 'signin' && !S.user) name = 'signin';
  if (window.PingGame && window.PingGame.isIn && window.PingGame.isIn() && name !== 'settle') { root.classList.remove('on'); return; }
  S.view = name; S.arg = arg;
  root.classList.add('on');
  const v = { signin: viewSignin, lobby: viewLobby, create: viewCreate, share: viewShare, settle: viewSettle }[name] || viewLobby;
  hostUi(false);
  v(arg);
  renderTop();
  setHash(name === 'share' ? '#/t/' + arg : name === 'settle' ? '#/settle' : '#/' + name);
}
window.addEventListener('hashchange', () => {
  if (hashLock || !S.user) return;
  const m = location.hash.match(/^#\/(signin|lobby|create)$/); const t = location.hash.match(/^#\/t\/([A-Za-z0-9]{6})$/i);
  if (m && m[1] !== S.view) show(m[1]); else if (t) openJoin(t[1]);
});

// ── sign in ───────────────────────────────────────────────────────
function viewSignin() {
  let tab = 'in', avatar = LS.get('ping.avatar') || 'a01', claim = false;
  const wrap = h('div', { class: 'lb-center' });
  const draw = () => {
    const err = h('div', { class: 'lb-err', id: 'lb-err', role: 'alert' });
    const name = h('input', { class: 'field', id: 'lb-name', type: 'text', maxlength: 16, autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Your name', value: LS.get('ping.name') || '' });
    const pin = h('input', { class: 'field pin-mask', id: 'lb-pin', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-1p-ignore': 'true', 'data-lpignore': 'true', placeholder: '4 to 6 digits',
      oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); } });
    const room = h('input', { class: 'field', id: 'lb-room', type: 'password', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Room password' });
    const submit = h('button', { class: 'btn btn--primary btn--lg btn--block', id: 'lb-submit', type: 'submit' }, tab === 'in' ? 'Sign in' : claim ? 'Claim name' : 'Create account');
    const fieldsAv = tab === 'up' ? h('div', { class: 'lb-field' }, h('label', null, 'Avatar'),
      h('div', { class: 'lb-avatars', id: 'lb-avatars' }, Array.from({ length: 12 }, (_, i) => { const id = 'a' + String(i + 1).padStart(2, '0');
        return h('button', { type: 'button', 'data-av': id, class: id === avatar ? 'on' : '', onclick: (e) => { avatar = id; LS.set('ping.avatar', id); wrap.querySelectorAll('.lb-avatars button').forEach((b) => b.classList.toggle('on', b.dataset.av === id)); } }, h('img', { src: avUrl(id), alt: id })); }))) : null;
    const form = h('form', { class: 'lb-sign panel', id: 'lb-signform', novalidate: true,
      onsubmit: (ev) => {
        ev.preventDefault(); if (Date.now() < S.lockUntil) return;
        const n = name.value.trim(), p = pin.value;
        if (n.length < 2) return showErr('Enter your name (2 to 16 characters).');
        if (!/^[A-Za-z0-9 _.\-']+$/.test(n)) return showErr('Names can only use letters, numbers, spaces and . _ - \' (no emoji or other symbols).');
        if (!/^\d{4,6}$/.test(p)) return showErr('PIN must be 4 to 6 digits.');
        LS.set('ping.name', n); showErr(''); submit.disabled = true;
        S.onError = () => { submit.disabled = false; };
        if (tab === 'in') emit('auth_login', { name: n, pin: p });
        else if (claim) emit('auth_claim', { name: n, pin: p, avatar, roomPassword: room.value });
        else emit('auth_signup', { name: n, pin: p, avatar });
      } },
      h('div', { class: 'logo' }, h('img', { src: 'images/ui/vp-mark.png', alt: '' }), h('b', null, 'THE ', h('em', null, 'PING')), h('span', { class: 'lb-eyebrow' }, 'Private poker tables for friends')),
      h('div', { class: 'seg seg--tabs seg--block', role: 'tablist' },
        h('button', { type: 'button', 'data-tab': 'in', class: tab === 'in' ? 'on' : '', onclick: () => { tab = 'in'; claim = false; draw(); } }, 'Sign in'),
        h('button', { type: 'button', 'data-tab': 'up', class: tab === 'up' ? 'on' : '', onclick: () => { tab = 'up'; draw(); } }, 'New account')),
      claim ? h('div', { class: 'note', id: 'lb-claim' }, 'This name is already on the books. Set a PIN to claim it, and enter the room password.') : null,
      h('div', { class: 'lb-field' }, h('label', { for: 'lb-name' }, 'Name'), name),
      h('div', { class: 'lb-field' }, h('label', { for: 'lb-pin' }, 'PIN'), pin),
      claim ? h('div', { class: 'lb-field' }, h('label', { for: 'lb-room' }, 'Room password'), room) : null,
      fieldsAv, err, submit);
    wrap.replaceChildren(form);
    function showErr(m) { err.textContent = m; }
    S.signErr = (code, retryMs, msg) => {
      submit.disabled = false;
      if (code === 'claim_required') { tab = 'up'; claim = true; const n = name.value, p = pin.value; draw(); $('lb-name').value = n; $('lb-pin').value = p; return; }
      if (code === 'rate_limited') { S.lockUntil = Date.now() + (retryMs || 30000); tickLock(); return; }
      const m = { name_taken: 'That name already has an account. Tap Sign in and use its PIN, or pick a different name.', bad_name: msg || 'Names are 2 to 16 letters, numbers, spaces, . _ - \'', bad_pin: tab === 'in' ? 'Wrong name or PIN.' : 'PIN must be 4 to 6 digits.',
        bad_credentials: 'Wrong name or PIN.', bad_room_password: 'That room password is not right.', bad_session: 'Your session expired. Sign in again.' }[code];
      showErr(m || msg || 'Could not sign in.');
    };
    S.signLock = () => {
      const left = Math.ceil((S.lockUntil - Date.now()) / 1000);
      if (left > 0) { showErr('Too many tries. Try again in ' + left + 's.'); submit.disabled = true; } else { showErr(''); submit.disabled = false; return true; }
    };
    if (Date.now() < S.lockUntil) tickLock();
    setTimeout(() => (S.deep && tab === 'in' ? pin : name).focus(), 30);
  };
  function tickLock() { clearInterval(lockT); lockT = setInterval(() => { if (!S.signLock || S.signLock()) clearInterval(lockT); }, 500); S.signLock && S.signLock(); }
  draw(); setMain(wrap);
}

// ── lobby ─────────────────────────────────────────────────────────
function tableLine(t) {
  const unit = t.unit || unitOf(t.mode);
  return [modeLabel(t.mode), fm(t.sb, unit) + '/' + fm(t.bb, unit) + ' blinds', 'buy in ' + fm(t.buyIn && t.buyIn.min, unit) + ' to ' + fm(t.buyIn && t.buyIn.max, unit), (t.seated ?? 0) + '/' + t.seats + ' seated'].join('  /  ');
}
function viewLobby() {
  emit('lobby_list', {}); emit('tables_mine', {}); emit('get_leaderboard', {}); emit('profile_get', {}); setTimeout(() => { if (S.view === 'lobby') emit('get_leaderboard', {}); }, 1500);
  const codeIn = h('input', { class: 'field field--code', id: 'lb-code', maxlength: 9, placeholder: 'CODE', autocomplete: 'off',
    oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const jerr = h('div', { class: 'lb-err', id: 'lb-joinerr' });
  const go = () => { const c = code6(codeIn.value); if (c.length < 6) { jerr.textContent = 'Codes are 6 characters.'; return; } jerr.textContent = ''; S.onError = (m) => { jerr.textContent = m; }; openJoin(c); };
  setMain(scrollWrap(h('div', { class: 'lb-wrap' }, h('div', { class: 'lb-cols' },
    h('div', { class: 'lb-stack' },
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Your tables'), h('div', { id: 'lb-mine', class: 'lb-rows' })),
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Open tables', h('small', null, 'Listed by their hosts')), h('div', { id: 'lb-open', class: 'lb-rows' }))),
    h('div', { class: 'lb-stack' },
      h('section', { class: 'lb-best panel panel--tight', id: 'lb-best', 'aria-label': 'Biggest win today' }),
      h('button', { class: 'btn btn--primary btn--lg btn--block', id: 'lb-create-btn', onclick: () => show('create') }, 'Create table'),
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Join by code'), h('div', { class: 'lb-stack', style: 'gap:var(--p12)' }, codeIn, h('button', { class: 'btn btn--secondary btn--block', id: 'lb-join-btn', onclick: go }, 'Join'), jerr)),
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Leaderboard', h('small', null, 'Lifetime net')), h('div', { id: 'lb-board' })),
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Around the table', h('small', null, 'Live')), h('div', { id: 'lb-feed', class: 'lb-feed' })))))));
  drawLists(); drawFeed(); drawBest(); emit('social:feed'); emit('social:biggest');
}
// ── activity feed ─────────────────────────────────────────────────
const FEED_ICON = { bigwin: 'vp-chip', bonus: 'ballot-cherry', levelup: 'vp-horseshoe', join: 'ping-hand', feature: 'i-pinged' };
let feedSkew = 0;
function feedBold(t) { return h('b', null, String(t == null ? '' : t).replace(/\*/g, '')); }
function feedText(e) {
  const nm = feedBold(e.name || 'Someone');
  if (e.kind === 'bigwin') {
    const amt = typeof e.amountCents === 'number' ? fm(e.amountCents, e.unit === 'chips' ? 'chips' : 'cents') : '';
    return e.game === 'bender' ? [nm, ' hit ', feedBold(amt), ' on Ballot Bender'] : [nm, ' took a ', feedBold(amt), ' pot'];
  }
  if (e.kind === 'bonus') return [nm, ' claimed the ', feedBold('Day ' + (e.day || 1)), ' bonus'];
  if (e.kind === 'levelup') return [nm, ' reached ', feedBold('level ' + e.level)];
  if (e.kind === 'join') return [nm, ' joined a table'];
  if (e.kind === 'feature') return [nm, ' hit ', feedBold(e.feature || 'a feature'), ' on Ballot Bender'];
  return [nm];
}
function feedAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - feedSkew - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const hr = Math.round(m / 60); return hr < 24 ? hr + 'h ago' : Math.round(hr / 24) + 'd ago';
}
function drawFeed() {
  const el = $('lb-feed'); if (!el) return;
  const list = S.feed || [];
  if (!list.length) {
    el.replaceChildren(h('div', { class: 'lb-feed-empty' }, h('img', { src: 'images/fx2/sticker-vp-charm.png', alt: '' }), h('span', null, 'Quiet in here, deal the first hand')));
    return;
  }
  el.replaceChildren(...list.map((e) => h('div', { class: 'lb-feed-row k-' + e.kind, 'data-id': e.id },
    h('img', { src: 'images/fx2/sticker-' + (FEED_ICON[e.kind] || 'vp-chip') + '.png', alt: '' }),
    h('span', { class: 'tx' }, ...feedText(e)), h('time', { 'data-ts': e.ts }, feedAgo(e.ts)))));
}
setInterval(() => { document.querySelectorAll('#lb-feed time[data-ts]').forEach((t) => { t.textContent = feedAgo(+t.dataset.ts); }); }, 30000);
function onFeed(p) {
  if (!p) return;
  if (typeof p.now === 'number') feedSkew = Date.now() - p.now;
  if (Array.isArray(p.list)) S.feed = p.list.slice(0, 8);
  else if (p.event && p.event.id != null) { if (!(S.feed || []).some((x) => x.id === p.event.id)) S.feed = [p.event, ...(S.feed || [])].slice(0, 8); }
  else return;
  if (S.view === 'lobby') drawFeed();
}

function drawLists() {
  const mine = $('lb-mine'), open = $('lb-open'), board = $('lb-board');
  if (mine) {
    const live = S.mine.filter((t) => t.state !== 'settled');
    mine.replaceChildren(...(live.length ? live.map((t) => {
      const unit = t.unit || unitOf(t.mode), n = S.net[tId(t)];
      const ended = t.state === 'ended';
      return h('div', { class: 'lb-row', 'data-table': tId(t) },
        h('div', null, h('div', { class: 't' }, t.name, tHost(t) === myKey() ? h('span', { class: 'tag' }, 'Host') : null, t.state === 'paused' ? h('span', { class: 'tag' }, 'Paused') : null, ended ? h('span', { class: 'tag' }, 'Ended') : null),
          h('div', { class: 's' }, tableLine(t), n != null ? h('span', null, '  /  Tonight ', h('b', { class: n > 0 ? 'up' : n < 0 ? 'down' : '' }, fm(n, unit, { signed: true }))) : null)),
        ended ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => emit('night_get', { nightId: t.nightId }) }, 'Settle up')
          : h('button', { class: 'btn btn--secondary btn--sm', 'data-resume': tId(t), onclick: () => { S.resume = tId(t); openJoin(tId(t)); } }, 'Resume'));
    }) : [h('div', { class: 'lb-empty' }, 'No tables yet. Create one, or join with a code.')]));
  }
  if (open) {
    const list = S.tables.filter((t) => !t.isPrivate && t.state !== 'ended');
    open.replaceChildren(...(list.length ? list.map((t) => h('div', { class: 'lb-row', 'data-table': tId(t) },
      h('div', null, h('div', { class: 't' }, t.name, t.host ? h('span', { class: 'lb-muted' }, 'hosted by ' + (t.host.display || t.host.key)) : null), h('div', { class: 's' }, tableLine(t))),
      h('button', { class: 'btn btn--secondary btn--sm', onclick: () => openJoin(tId(t)) }, 'Join'))) : [h('div', { class: 'lb-empty' }, 'No open tables right now.')]));
  }
  if (board) {
    const rows = S.board.slice(0, 5), me = S.boardMe;
    const row = (e, i) => {
      const v = e.netCents ?? 0, mine = S.user && e.key === S.user.key;
      return h('div', { class: 'lb-lead' + (mine ? ' me' : '') }, h('span', { class: 'rk' }, e.rank || i + 1), h('img', { src: avSrc(e), alt: '' }), h('span', null, (e.display || e.key) + (mine ? ' (you)' : '')), h('b', { class: v > 0 ? 'up' : v < 0 ? 'down' : '' }, fm(v, 'cents', { signed: true })));
    };
    const out = rows.map(row);
    if (me && !rows.some((e) => e.key === me.key)) out.push(h('div', { class: 'lb-lead-gap' }, '...'), row(me, 0));
    board.replaceChildren(...(out.length ? out : [h('div', { class: 'lb-empty' }, 'Nobody on the board yet.')]));
  }
}

// ── modal ─────────────────────────────────────────────────────────
function closeModal() { document.querySelectorAll('.lb-scrim').forEach((n) => n.remove()); if (root) root.classList.remove('lb-overlay'); S.modalKey && document.removeEventListener('keydown', S.modalKey); S.modalKey = null; S.onModalClose && S.onModalClose(); S.onModalClose = null; }
// A modal is a panel: title bar first, a scrolling body, and the .acts footer last so it never covers the body
function modalBox(kids) {
  const k = kids.filter(Boolean), isT = (n) => n.classList && n.classList.contains('panel__title'), isA = (n) => n.classList && n.classList.contains('acts');
  const title = k.filter(isT), foot = k.filter(isA), body = k.filter((n) => !isT(n) && !isA(n));
  return h('div', { class: 'lb-modal panel', role: 'dialog' }, ...title, h('div', { class: 'lb-modal-body' }, ...body), ...foot);
}
const closeBtn = () => h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Close', onclick: closeModal }, '\u00d7');
function openModal(...kids) {
  closeModal(); ensureRoot();
  const sc = h('div', { class: 'lb-scrim', onmousedown: (e) => { if (e.target === sc) closeModal(); } }, modalBox(kids));
  S.modalKey = (e) => { if (e.key === 'Escape') closeModal(); }; document.addEventListener('keydown', S.modalKey);
  root.append(sc); return sc;
}

// ── settings summary card ─────────────────────────────────────────
function settingsCard(t) {
  const unit = t.unit || unitOf(t.mode), bb = t.blinds ? t.blinds.bb : t.bb, sb = t.blinds ? t.blinds.sb : t.sb, bi = t.buyIn || {};
  const cell = (k, v) => h('div', null, h('small', null, k), h('b', null, v));
  return h('div', { class: 'lb-set panel panel--inset', id: 'lb-settings' },
    cell('Mode', modeLabel(t.mode)), cell('Blinds', fm(sb, unit) + ' / ' + fm(bb, unit)),
    cell('Buy-in', fm(bi.min, unit) + ' to ' + fm(bi.max, unit)), cell('Seats', t.seats),
    cell('Clock', t.actionTimerSec ? t.actionTimerSec + 's' : 'None'), cell('Host', (t.host && t.host.display) || (t.hostKey || '')),
    t.blindIncrease && t.blindIncrease.enabled ? cell('Blinds rise', 'every ' + t.blindIncrease.everyMin + ' min') : null, cell('Rebuys', t.rebuys === false ? 'Off' : 'On'));
}

// ── buy-in picker (AmountInput: the number is the truth, the text is a view) ──
function buyInPicker(t, mySettled) {
  const unit = t.unit || unitOf(t.mode), bi = t.buyIn;
  let fund = t.mode;
  const bankOf = (f) => { const v = f === 'chips' ? (S.user && (S.user.bankChips ?? S.user.chips)) : (S.wallet ? S.wallet.play : null); return Number.isFinite(v) ? v : null; };
  const hiOf = (bk) => (bk != null ? Math.min(bi.max, bk) : bi.max);
  const presetsFor = (hi) => [{ label: 'Min', units: bi.min }, { label: 'Default', units: bi.default }, { label: 'Max', units: hi }];
  let bank = bankOf(fund), hi = hiOf(bank);
  const short = () => bank != null && bank < bi.min; // cannot afford the minimum: nothing to pick
  const f = AmountInput({ units: Math.min(Math.max(bi.min, bi.default), Math.max(bi.min, hi)), min: bi.min, max: Math.max(bi.min, hi), unit, scale: 'ladder', presets: presetsFor(Math.max(bi.min, hi)), label: 'Buy-in', rangeLabel: 'Buy-in', onChange: () => drawBal() });
  f.input.id = 'lb-buyin-input'; f.slider.id = 'lb-buyin-range'; f.el.id = 'lb-buyin';
  const balLine = h('div', { class: 'lb-muted', id: 'lb-fund-bal' });
  const drawBal = () => {
    const cross = fund !== t.mode, v = f.value();
    balLine.textContent = bank == null ? '' : (fund === 'play' ? 'Your Play $: ' + fm(bank, 'cents') : 'Your bank: ' + fm(bank, 'chips'))
      + (short() ? '. Not enough for the minimum buy-in of ' + fm(bi.min, unit) + '.' : '')
      + (cross && v != null ? '. This buy-in costs ' + (fund === 'play' ? fm(v, 'cents') : fm(v, 'chips')) + ' (1 chip = $0.01).' : '');
  };
  const fundBtn = (k, label) => h('button', { type: 'button', class: fund === k ? 'on' : '', 'aria-pressed': fund === k ? 'true' : 'false', id: 'lb-fund-' + k, onclick: () => {
    if (fund === k) return; fund = k; bank = bankOf(fund); hi = hiOf(bank);
    const top = Math.max(bi.min, hi), cur = f.value();
    f.setBounds({ min: bi.min, max: top, presets: presetsFor(top) });
    f.set(cur == null ? bi.default : Math.min(top, Math.max(bi.min, cur)), { source: 'fund' });
    fundRow.replaceChildren(fundBtn('chips', 'Chips'), fundBtn('play', 'Play $')); drawBal();
  } }, label);
  const fundRow = h('div', { class: 'seg seg--block', id: 'lb-fund' }, fundBtn('chips', 'Chips'), fundBtn('play', 'Play $'));
  drawBal();
  const night = mySettled != null ? h('div', { class: 'lb-muted' }, 'Your night so far: ', h('b', { class: mySettled > 0 ? 'up' : mySettled < 0 ? 'down' : '' }, fm(mySettled, unit, { signed: true }))) : null;
  // the fund picker sits above the slider so the modal footer can never hide it (ui 11)
  const el = h('div', { class: 'lb-stack', style: 'gap:var(--p14)' }, fundRow, balLine, h('div', { class: 'lb-field' }, h('label', null, 'Buy-in'), f.el), night);
  // get(): integer units or null. Out of range, unparsable or unaffordable never seats (S1-3); the message stays visible.
  const get = () => { if (short()) return null; const v = f.value(); if (v === null) { f.submit(); try { f.el.scrollIntoView({ block: 'center' }); } catch (e) {} } return v; };
  return { el, get, getFund: () => fund, field: f, short };
}

// ── join / buy-in modal ───────────────────────────────────────────
function openJoin(code) {
  code = (S.tables.concat(S.mine).find((t) => tId(t) === String(code).toUpperCase()) ? String(code).toUpperCase() : code6(code));
  if (!getSock()) return;
  S.pendingJoin = code; emit('table_preview', { code });
}
// The caller's seat in a table_info: in `seated` when connected, else from the additive `you` key (a disconnected seat is not listed there).
function seatOfMine(info) {
  const me = (info.seated || []).find((p) => p.key === myKey());
  if (me) return me;
  return info.you && info.you.seated ? { key: myKey(), stack: info.you.stack, display: (S.user && S.user.display) || myKey() } : null;
}
function onInfo(info) {
  const t = info.table; if (!t) return;
  S.info[tId(t)] = info;
  if (hostDrawer && S.cur && tId(S.cur) === tId(t)) drawDrawer();
  if (S.view === 'share' && S.arg === tId(t)) { drawShare(); return; }
  if (S.pendingJoin && S.pendingJoin === tId(t)) {
    S.pendingJoin = null; S.onError = null;
    const me = seatOfMine(info);
    // A seat you already hold is never offered a buy-in form: go straight back to it (the server rebinds, the typed amount would be ignored).
    if (me && t.state !== 'ended') { S.resume = S.rebind = null; S.onError = (m) => { S.onError = null; if (S.view === 'lobby') { modalJoin(info, me); const e = $('lb-joinmsg'); if (e) e.textContent = m; } }; emit('table_join', { tableId: tId(t), buyIn: me.stack || t.buyIn.default }); return; }
    S.resume = S.rebind = null;
    if (t.state === 'ended') { emit('night_get', { nightId: t.nightId }); return; }
    if (tHost(t) === myKey() && !me && S.view !== 'share' && S.view !== 'signin') { show('share', tId(t)); return; }
    modalJoin(info, me);
  }
}
function modalJoin(info, me) {
  const t = info.table, id = tId(t), unit = t.unit || unitOf(t.mode);
  const pick = buyInPicker(t, S.net[id]);
  const err = h('div', { class: 'lb-err', id: 'lb-joinmsg' });
  const sit = h('button', { class: 'btn btn--primary', id: 'lb-sit', onclick: () => {
    const v = me ? (me.stack || t.buyIn.default) : pick.get(); if (v == null) { err.textContent = pick.short() ? 'Your balance is below the minimum buy-in.' : 'Fix the buy-in amount first.'; return; }
    sit.disabled = true; err.textContent = ''; S.onError = (m) => { sit.disabled = false; err.textContent = m; };
    emit('table_join', { tableId: id, buyIn: v, fund: pick.getFund() });
  } }, me ? 'Return to seat' : 'Sit down');
  openModal(
    h('h3', { class: 'panel__title' }, t.name, h('small', null, 'Table ' + id), closeBtn()),
    me ? h('div', { class: 'lb-muted' }, 'You are already seated here with ' + fm(me.stack, unit) + '.') : pick.el,
    err,
    settingsCard(t),
    h('div', { class: 'lb-seatlist' }, seatCells(info, true)),
    h('div', { class: 'lb-copy' }, modeNote(t.mode)),
    h('div', { class: 'acts' }, h('button', { class: 'btn btn--secondary', id: 'lb-cancel', onclick: closeModal }, 'Cancel'), sit));
}
function seatCells(info, compact) {
  const t = info.table, unit = t.unit || unitOf(t.mode);
  const cells = (info.seated || []).map((p) => h('div', { class: 'lb-seat panel panel--inset' }, h('img', { src: avSrc(p), alt: '' }), h('div', null, h('b', null, p.display || p.key), h('span', null, fm(p.stack, unit)))));
  const away = (info.away || []).map((p) => h('div', { class: 'lb-seat away panel panel--inset' }, h('div', null, h('b', null, (p.key === myKey() ? 'You' : p.display || p.key) + ' (away)'), h('span', null, fm(p.stack, unit)))));
  cells.push(...away);
  const open = Math.max(0, (info.openSeats ?? t.seats - (info.seated || []).length));
  if (compact) { if (open) cells.push(h('div', { class: 'lb-seat open panel panel--inset' }, open + (open === 1 ? ' open seat' : ' open seats'))); return cells; }
  for (let i = 0; i < open; i++) cells.push(h('div', { class: 'lb-seat open panel panel--inset' }, 'Open seat'));
  return cells;
}

// ── create ────────────────────────────────────────────────────────
const PRESETS = { cents: [[25, 50], [50, 100], [100, 200], [200, 500], [500, 1000], [2500, 5000]], chips: [[25, 50], [50, 100], [100, 200], [250, 500], [500, 1000]] };
function freshForm(mode, prev) {
  const unit = unitOf(mode), c = unit === 'chips';
  return Object.assign({ mode, unit, name: (prev && prev.name) || ((S.user && S.user.display) || 'My') + "'s table",
    min: 500, max: c ? 1000000 : 50000, def: c ? 2000 : mode === 'play' ? 2000 : 10000, preset: c ? 0 : mode === 'play' ? 0 : 1, custom: false, csb: c ? 50 : 50, cbb: c ? 100 : 100,
    seats: 8, timer: 30, bi: false, biEvery: 15, biSched: 'standard', rebuys: true, priv: true }, prev ? { seats: prev.seats, timer: prev.timer, bi: prev.bi, biEvery: prev.biEvery, biSched: prev.biSched, rebuys: prev.rebuys, priv: prev.priv } : {});
}
function blindsOf(f) { if (f.custom) return { sb: f.csb, bb: f.cbb }; const p = PRESETS[f.unit][f.preset]; return { sb: p[0], bb: p[1] }; }
function viewCreate() {
  const f = S.form = S.form || freshForm('play');
  const host = h('div', { class: 'lb-form panel', id: 'lb-form' }), side = h('div', { class: 'lb-stack' });
  const grid = h('div', { class: 'lb-create' }, host, side);
  setMain(scrollWrap(h('div', { class: 'lb-wrap' }, h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('button', { class: 'btn btn--ghost btn--sm', onclick: () => show('lobby') }, 'Back to lobby')), grid)));
  const draw = () => {
    const sc = mainEl.firstChild.scrollTop; host.replaceChildren(...formBody(f, draw, refreshSum).filter(Boolean)); side.replaceChildren(sumCard()); mainEl.firstChild.scrollTop = sc;
  };
  const sumCard = () => {
    const el = h('section', { class: 'panel lb-sum', id: 'lb-sum' }); S.sumEl = el; fillSummary(f, el);
    const err = h('div', { class: 'lb-err', id: 'lb-createerr' });
    const btn = h('button', { class: 'btn btn--primary btn--lg btn--block', id: 'lb-create-submit', onclick: () => submitCreate(f, err, btn) }, 'Create table');
    return h('div', { class: 'lb-stack' }, el, err, btn);
  };
  const refreshSum = () => fillSummary(f, S.sumEl);
  draw();
}
function fillSummary(f, el) {
  if (!el) return; const b = blindsOf(f), u = f.unit;
  const sug = Math.min(f.max, Math.max(f.min, b.bb * 100));
  el.replaceChildren(
    h('div', { class: 'lb-eyebrow' }, 'Summary'), h('div', { class: 'big' }, f.name || 'Untitled'),
    h('dl', null, h('dt', null, 'Mode'), h('dd', null, modeLabel(f.mode)), h('dt', null, 'Blinds'), h('dd', null, fm(b.sb, u) + ' / ' + fm(b.bb, u)),
      h('dt', null, 'Buy-in'), h('dd', null, fm(f.min, u) + ' to ' + fm(f.max, u) + ', default ' + fm(f.def, u)), h('dt', null, 'Seats'), h('dd', null, f.seats),
      h('dt', null, 'Clock'), h('dd', null, f.timer ? f.timer + 's' : 'None'), h('dt', null, 'Blinds rise'), h('dd', null, f.bi ? 'every ' + f.biEvery + ' min' : 'Off'),
      h('dt', null, 'Rebuys'), h('dd', null, f.rebuys ? 'On' : 'Off'), h('dt', null, 'Visibility'), h('dd', null, f.priv ? 'Private, code only' : 'Listed in lobby')),
    ...(f.min < b.bb * 20 ? [h('div', { class: 'lb-warn', id: 'lb-warn' }, 'Minimum buy-in is under 20 big blinds. Short stacks play fast.')] : []),
    h('div', { class: 'lb-muted' }, 'Suggested buy-in: ' + fm(sug, u) + ' (100 big blinds).'),
    h('div', { class: 'lb-copy' }, modeNote(f.mode)));
}
function seg(opts, cur, onPick, id) {
  return h('div', { class: 'seg seg--block', id }, opts.map(([v, label, sub]) => h('button', { type: 'button', 'data-v': String(v), class: String(v) === String(cur) ? 'on' : '', onclick: () => onPick(v) }, label, sub ? h('small', null, sub) : null)));
}
function formBody(f, redraw, sum) {
  const u = f.unit, g = (label, ...k) => h('div', { class: 'grp' }, h('span', { class: 'lb-label' }, label), ...k);
  const set = (k) => (v) => { f[k] = v; redraw(); };
  const modeSeg = seg([['play', 'Play $', 'fake money'], ['chips', 'Chips', 'bank chips']], f.mode, (m) => { if (m !== f.mode) { S.form = Object.assign(f, freshForm(m, f)); } redraw(); }, 'lb-mode');
  const name = h('input', { class: 'field', id: 'lb-tname', maxlength: 24, value: f.name, oninput: (e) => { f.name = e.target.value; sum(); } });
  // buy-in range: the three typed boxes are AmountInputs (the number is the truth); the dual slider only drives them.
  // The slider span always covers what is typed (S3-2), the server accepts 1..MAX_UNITS.
  const LO = 500, HI = u === 'chips' ? 1000000 : 50000, MAX_UNITS = 100000000;
  const vals = ladder(u, Math.min(LO, f.min), Math.max(HI, f.max), [f.min, f.max, f.def]);
  const rl = h('input', { type: 'range', min: 0, max: vals.length - 1, step: 1, value: nearIdx(vals, f.min), 'aria-label': 'Minimum buy-in' });
  const rh = h('input', { type: 'range', min: 0, max: vals.length - 1, step: 1, value: nearIdx(vals, f.max), 'aria-label': 'Maximum buy-in' });
  const fill = h('div', { class: 'fill' });
  const fields = S.formFields = [];
  const crossMsg = h('div', { class: 'lb-err', id: 'lb-bcross' });
  const cross = () => { crossMsg.textContent = f.min <= f.def && f.def <= f.max ? '' : 'Buy-in needs minimum <= default <= maximum.'; };
  const mk = (key, id, label, lo) => {
    const a = AmountInput({ units: f[key], min: lo, max: MAX_UNITS, unit: u, scale: 'ladder', compact: true, label, rangeLabel: label,
      onChange: (v) => { if (v != null && v !== f[key]) { f[key] = v; if (key === 'min' || key === 'max') syncSlider(); cross(); sum(); } } });
    a.input.id = id; fields.push(a); return a;
  };
  const inMin = mk('min', 'lb-bmin', 'Minimum buy-in', 1), inDef = mk('def', 'lb-bdef', 'Default buy-in', 1), inMax = mk('max', 'lb-bmax', 'Maximum buy-in', 1);
  const n1 = Math.max(1, vals.length - 1);
  const paint = () => { const a = rl.value / n1, b = rh.value / n1; fill.style.left = 'calc(var(--p8) + (100% - var(--p16)) * ' + a + ')'; fill.style.width = 'calc((100% - var(--p16)) * ' + (b - a) + ')'; };
  const syncSlider = () => { rl.value = nearIdx(vals, f.min); rh.value = nearIdx(vals, f.max); paint(); };
  rl.addEventListener('input', () => { if (+rl.value > +rh.value) rl.value = rh.value; f.min = vals[+rl.value]; inMin.set(f.min, { source: 'slider' }); paint(); cross(); sum(); });
  rh.addEventListener('input', () => { if (+rh.value < +rl.value) rh.value = rl.value; f.max = vals[+rh.value]; inMax.set(f.max, { source: 'slider' }); paint(); cross(); sum(); });
  paint(); cross();
  const b = blindsOf(f);
  const blindSeg = h('div', { class: 'seg seg--block', id: 'lb-blinds' }, PRESETS[u].map((p, i) => h('button', { type: 'button', 'data-v': i, class: !f.custom && i === f.preset ? 'on' : '', onclick: () => { f.custom = false; f.preset = i; redraw(); } }, fm(p[0], u) + '/' + fm(p[1], u))),
    h('button', { type: 'button', 'data-v': 'custom', class: f.custom ? 'on' : '', onclick: () => { f.custom = true; f.csb = b.sb; f.cbb = b.bb; redraw(); } }, 'Custom'));
  const mkBlind = (key, id, label, lo) => {
    const a = AmountInput({ units: f[key], min: lo, max: MAX_UNITS, unit: u, scale: 'ladder', compact: true, label, rangeLabel: label, onChange: (v) => { if (v != null && v !== f[key]) { f[key] = v; sum(); } } });
    a.input.id = id; fields.push(a); return a;
  };
  const custom = f.custom ? h('div', { class: 'lb-two' },
    h('div', { class: 'lb-field' }, h('label', null, 'Small blind'), mkBlind('csb', 'lb-csb', 'Small blind', 1).el),
    h('div', { class: 'lb-field' }, h('label', null, 'Big blind'), mkBlind('cbb', 'lb-cbb', 'Big blind', 2).el)) : null;
  const seats = h('div', { class: 'seg seg--stepper seg--block', id: 'lb-seats' }, h('button', { type: 'button', 'aria-label': 'Fewer seats', onclick: () => { f.seats = Math.max(2, f.seats - 1); redraw(); } }, '−'), h('b', null, f.seats), h('button', { type: 'button', 'aria-label': 'More seats', onclick: () => { f.seats = Math.min(8, f.seats + 1); redraw(); } }, '+'));
  const onOff = (k, id) => seg([[true, 'On'], [false, 'Off']], f[k], set(k), id);
  return [
    g('Game', modeSeg),
    h('div', { class: 'lb-field' }, h('label', { for: 'lb-tname' }, 'Table name'), name),
    g('Blinds', blindSeg, custom),
    g('Buy-in range', h('div', { class: 'lb-slider' }, h('div', { class: 'trk' }), fill, rl, rh), h('div', { class: 'lb-amts' },
      h('div', { class: 'lb-field' }, h('label', null, 'Minimum'), inMin.el), h('div', { class: 'lb-field' }, h('label', null, 'Default'), inDef.el), h('div', { class: 'lb-field' }, h('label', null, 'Maximum'), inMax.el)), crossMsg),
    h('div', { class: 'lb-two' }, g('Seats', seats), g('Action clock', seg([[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s'], [0, 'Off']], f.timer, set('timer'), 'lb-timer'))),
    h('div', { class: 'lb-two' }, g('Blinds rise over time', seg([[true, 'On'], [false, 'Off']], f.bi, set('bi'), 'lb-bi')), g('Rebuys', onOff('rebuys', 'lb-rebuys'))),
    f.bi ? h('div', { class: 'lb-two' }, g('Every', seg([[10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min']], f.biEvery, set('biEvery'), 'lb-bievery')), g('Pace', seg([['standard', 'Standard'], ['turbo', 'Turbo']], f.biSched, set('biSched'), 'lb-bisched'))) : null,
    g('Visibility', seg([[true, 'Private', 'code or link only'], [false, 'Listed', 'shows in lobby']], f.priv, set('priv'), 'lb-priv')),
  ];
}
function submitCreate(f, err, btn) {
  const b = blindsOf(f), nm = f.name.trim();
  const bad = (S.formFields || []).find((a) => a.value() === null);
  if (bad) { bad.submit(); try { bad.el.scrollIntoView({ block: 'center' }); } catch (e) {} return (err.textContent = 'Fix the highlighted amount first.'); }
  if (nm.length < 2 || nm.length > 24) return (err.textContent = 'Table name is 2 to 24 characters.');
  if (!(b.sb >= 1 && b.bb > b.sb && b.bb >= 2)) return (err.textContent = 'Small blind must be less than big blind.');
  if (!(f.min <= f.def && f.def <= f.max)) return (err.textContent = 'Buy-in needs min <= default <= max.');
  err.textContent = ''; btn.disabled = true; S.onError = (m) => { btn.disabled = false; err.textContent = m; };
  emit('table_create', { settings: { name: nm, mode: f.mode, unit: f.unit, moneyMode: f.mode,
    buyIn: { min: f.min, max: f.max, default: f.def }, blinds: b, blindIncrease: { enabled: f.bi, everyMin: f.biEvery, schedule: f.biSched },
    seats: f.seats, actionTimerSec: f.timer, rebuys: f.rebuys, rebuyLimit: 0, isPrivate: f.priv } });
}

// ── share ─────────────────────────────────────────────────────────
function viewShare(id) {
  S.shareBox = h('div', { class: 'lb-wrap' }); setMain(scrollWrap(S.shareBox));
  emit('table_preview', { code: id });
  pollT = setInterval(() => emit('table_preview', { code: id }), 3000);
  drawShare();
}
function drawShare() {
  const id = S.arg, info = S.info[id], t = info ? info.table : (S.cur && tId(S.cur) === id ? S.cur : null);
  if (!S.shareBox || !t) return;
  const link = location.origin + '/?t=' + id, unit = t.unit || unitOf(t.mode);
  const me = info && seatOfMine(info), n = info ? (info.seated || []).length : 0;
  const isHost = tHost(t) === myKey() || isAdmin();
  const err = h('div', { class: 'lb-err', id: 'lb-sharemsg' }, S.shareErr || '');
  // the error stays across the 3 s preview redraws until the next action (S2-2)
  const setErr = (m) => { S.shareErr = m || ''; err.textContent = S.shareErr; };
  let right;
  if (me) {
    right = h('section', { class: 'panel lb-stack' }, h('h2', { class: 'panel__title' }, 'You are seated'), h('div', { class: 'lb-muted' }, 'Stack ' + fm(me.stack, unit) + '. The hand deals automatically when a second player sits.'),
      isHost && n >= 2 ? h('button', { class: 'btn btn--secondary btn--block', id: 'lb-start', onclick: () => emit('table_start', { tableId: id }) }, 'Start when ready') : null,
      h('button', { class: 'btn btn--primary btn--block', id: 'lb-enter', onclick: () => { setErr(''); S.onError = (m) => { setErr(m); }; emit('table_join', { tableId: id, buyIn: me.stack || t.buyIn.default }); } }, 'Go to the table'), err);
  } else {
    const pick = S.sharePick && S.sharePick.id === id ? S.sharePick.p : (S.sharePick = { id, p: buyInPicker(t, S.net[id]) }).p;
    const sit = h('button', { class: 'btn btn--primary btn--block', id: 'lb-sit', onclick: () => { setErr(''); const v = pick.get(); if (v == null) { setErr(pick.short() ? 'Your balance is below the minimum buy-in.' : 'Fix the buy-in amount first.'); return; } sit.disabled = true; S.onError = (m) => { sit.disabled = false; setErr(m); }; emit('table_join', { tableId: id, buyIn: v, fund: pick.getFund() }); } }, 'Sit down');
    right = h('section', { class: 'panel lb-stack' }, h('h2', { class: 'panel__title' }, 'Take your seat'), pick.el, h('div', { class: 'lb-copy' }, modeNote(t.mode)), err, sit);
  }
  S.shareBox.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('button', { class: 'btn btn--ghost btn--sm', onclick: () => show('lobby') }, 'Back to lobby')),
    h('div', { class: 'lb-share' },
      h('div', { class: 'lb-stack' },
        h('section', { class: 'panel' }, h('div', { class: 'lb-eyebrow', style: 'text-align:center' }, t.name + '  /  share this code'), h('div', { class: 'lb-code', id: 'lb-sharecode' }, id),
          h('div', { class: 'lb-btns' }, h('button', { class: 'btn btn--secondary', id: 'lb-copylink', onclick: () => copy(link, 'Link') }, 'Copy link'), h('button', { class: 'btn btn--secondary', id: 'lb-copycode', onclick: () => copy(id, 'Code') }, 'Copy code'))),
        h('section', { class: 'panel lb-stack' }, h('h2', { class: 'panel__title' }, 'Who is sitting', h('small', null, n + ' of ' + t.seats)), info ? h('div', { class: 'lb-seatlist' }, seatCells(info)) : null, settingsCard(t))),
      right));
}

// ── achievements + biggest win band ───────────────────────────────
const ACH_ICON = { bronze: 'vp-chip', silver: 'vp-horseshoe', gold: 'boba-crown' };
const ACH_TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
function achTile(a) {
  return h('div', { class: 'lb-achv t-' + a.tier + (a.done ? ' done' : ' locked'), title: a.desc + (a.done ? '' : ' (' + (a.unit === 'cents' ? fm(a.progress || 0, 'cents') + ' / ' + fm(a.target, 'cents') : a.progress + '/' + a.target) + ')') },
    h('img', { src: 'images/fx2/sticker-' + ACH_ICON[a.tier] + '.png', alt: '' }),
    h('b', null, a.name),
    h('small', null, a.done ? ACH_TIER_LABEL[a.tier] : a.desc),
    h('i', null, a.done ? '+' + fm(a.rewardCents, 'cents') : (a.unit === 'cents' ? fm(a.progress || 0, 'cents') + ' / ' + fm(a.target, 'cents') : (a.progress || 0).toLocaleString('en-US') + '/' + a.target.toLocaleString('en-US'))));
}
function drawAch() {
  const el = $('lb-ach'); if (!el) return;
  const v = S.achv;
  if (!v) { el.replaceChildren(h('div', { class: 'lb-muted' }, 'Loading trophies')); return; }
  const rank = { true: 0, false: 1 };
  const list = v.list.slice().sort((a, b) => rank[a.done] - rank[b.done] || (a.done ? b.ts - a.ts : (b.progress / b.target) - (a.progress / a.target)));
  el.replaceChildren(...list.map(achTile));
  const c = $('lb-ach-count'); if (c) c.textContent = v.unlocked + ' of ' + v.total;
}
function achSection() {
  return h('div', { class: 'lb-field' }, h('label', null, 'Achievements ', h('small', { id: 'lb-ach-count', class: 'lb-muted' }, S.achv ? S.achv.unlocked + ' of ' + S.achv.total : '')), h('div', { class: 'lb-achgrid', id: 'lb-ach' }));
}
function renderAchHint() {
  const n = (S.achv && S.achv.unseen) || 0;
  document.querySelectorAll('.lb-achdot').forEach((d) => d.remove());
  if (!n) return;
  const mk = () => h('span', { class: 'lb-achdot', title: n + ' new achievement' + (n > 1 ? 's' : '') + ', open your profile' }, String(n));
  const acct = $('lb-acct'); if (acct) acct.appendChild(mk());
  const lvl = $('sh-lvl'); if (lvl) lvl.appendChild(mk());
}
function drawBest() {
  const el = $('lb-best'); if (!el) return;
  const w = S.best && S.best.win;
  if (w && Date.now() - feedSkew - w.ts > 86400000) S.best = null;
  const win = S.best && S.best.win;
  if (!win) { el.replaceChildren(h('img', { src: 'images/fx2/sticker-vp-charm.png', alt: '' }), h('div', { class: 'tx' }, h('small', null, 'Biggest win today'), h('b', null, 'No big win yet. Be first.'))); el.classList.add('empty'); return; }
  el.classList.remove('empty');
  el.replaceChildren(h('img', { src: 'images/fx2/sticker-vp-charm.png', alt: '' }),
    h('div', { class: 'tx' }, h('small', null, 'Biggest win today'), h('b', null, fm(win.amountCents, 'cents')), h('span', null, win.name + ' on ' + (win.game === 'bender' ? 'Ballot Bender' : 'Poker'))),
    h('time', { 'data-ts': win.ts }, feedAgo(win.ts)));
}
function onBest(p) { if (!p) return; if (typeof p.now === 'number') feedSkew = Date.now() - p.now; S.best = p; drawBest(); }
setInterval(() => { if (S.user && S.view === 'lobby') emit('social:biggest'); }, 300000);
setInterval(drawBest, 60000);
// ── profile ───────────────────────────────────────────────────────
const NAME_OK = /^[A-Za-z0-9 _.\-']+$/;
function nameProblem(n) {
  if (n.length < 2 || n.length > 16) return 'Names are 2 to 16 characters.';
  if (!NAME_OK.test(n)) return 'Use letters, numbers, spaces, . _ - and apostrophes only.';
  return '';
}
// File -> 128x128 centre-cropped JPEG data URL under ~40KB
function photoToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type || '') || /svg/i.test(file.type)) { reject('Pick a photo (JPEG, PNG or WebP), not a vector file.'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth || img.width, hgt = img.naturalHeight || img.height, side = Math.min(w, hgt);
      if (!side) { reject('Could not read that picture.'); return; }
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'); x.fillStyle = '#17100B'; x.fillRect(0, 0, 128, 128);
      x.drawImage(img, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, 128, 128);
      for (const q of [0.82, 0.7, 0.55, 0.4]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 38000) { resolve(d); return; } }
      reject('That picture is too detailed. Try another one.');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject('Could not read that picture.'); };
    img.src = url;
  });
}
// Sync an open profile modal with S.user (after a save from this or another device)
function refreshProfile() {
  renderTop();
  const u = S.user; if (!u) return;
  const av = $('lb-profav'); if (av) av.src = avSrc(u);
  const nm = $('lb-profname'); if (nm) nm.textContent = u.display || u.key;
  const up = $('lb-usepreset'); if (up) up.style.display = u.pic ? '' : 'none';
  document.querySelectorAll('.lb-avatars button').forEach((b) => b.classList.toggle('on', !u.pic && b.firstChild && b.firstChild.alt === String(u.avatar).replace(/\.png$/, '')));
}
function openProfile() {
  emit('profile_get', {}); emit('account:stats', {}); emit('achv:state', {});
  if (S.achv && S.achv.unseen) setTimeout(() => { if ($('lb-ach')) { emit('achv:seen', {}); } }, 1200);
  const p = S.profile || {}, u = S.user, st = p.stats || {};
  let av = u.avatar;
  const net = p.netCents ?? 0, msg = h('div', { class: 'lb-err', id: 'lb-profmsg' });
  const oldPin = h('input', { class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true', placeholder: 'Current PIN', id: 'lb-oldpin', oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); } });
  const newPin = h('input', { class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true', placeholder: 'New PIN', id: 'lb-newpin', oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); } });
  const recent = (p.recent || []).slice(0, 5);
  const nameMsg = h('div', { class: 'lb-err', id: 'lb-namemsg' }), photoMsg = h('div', { class: 'lb-err', id: 'lb-photomsg' });
  const nameIn = h('input', { class: 'field', id: 'lb-dispname', type: 'text', maxlength: 16, value: u.display || u.key, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') saveName(); } });
  const fileIn = h('input', { type: 'file', accept: 'image/*', id: 'lb-photofile', style: 'display:none', onchange: () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return; photoMsg.classList.remove('ok'); photoMsg.textContent = 'Preparing photo...'; photoToAvatar(f).then((url) => { photoMsg.textContent = ''; emit('profile_update', { avatarPic: url }); }, (m) => { photoMsg.textContent = m; }); } });
  function saveName() {
    const raw = nameIn.value.replace(/\s+/g, ' ').trim(), bad = nameProblem(raw);
    nameMsg.classList.remove('ok');
    if (bad) { nameMsg.textContent = bad; return; }
    if (raw === S.user.display) { nameMsg.textContent = 'That is already your name.'; return; }
    nameMsg.textContent = ''; S.pendingName = raw;
    emit('profile_update', { display: raw });
  }
  openModal(
    h('h3', { class: 'panel__title' }, 'Profile', closeBtn()),
    h('div', { class: 'lb-prof-hd' }, h('img', { id: 'lb-profav', class: 'lb-prof-av', src: avSrc(u), alt: '' }), h('div', { class: 'lb-prof-id' }, h('h3', { id: 'lb-profname' }, u.display || u.key), h('div', { class: 'lb-muted' }, 'Signed in'))),
    h('div', { class: 'lb-field' }, h('label', { for: 'lb-dispname' }, 'Display name'),
      h('div', { class: 'lb-inline' }, nameIn, h('button', { type: 'button', class: 'btn btn--secondary btn--sm', id: 'lb-namesave', onclick: saveName }, 'Save')),
      nameMsg),
    h('div', { class: 'lb-field' }, h('label', null, 'Avatar'),
      h('div', { class: 'lb-inline lb-photo' }, h('button', { type: 'button', class: 'btn btn--secondary btn--sm', id: 'lb-photobtn', onclick: () => fileIn.click() }, 'Upload photo'), fileIn,
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'lb-usepreset', style: u.pic ? '' : 'display:none', onclick: () => { photoMsg.textContent = ''; emit('profile_update', { avatarPic: null }); } }, 'Use preset instead')),
      photoMsg,
      h('div', { class: 'lb-avatars' }, Array.from({ length: 12 }, (_, i) => { const id = 'a' + String(i + 1).padStart(2, '0');
        return h('button', { type: 'button', class: !u.pic && id === String(av).replace(/\.png$/, '') ? 'on' : '', onclick: (e) => { av = id; photoMsg.textContent = ''; emit('profile_update', u.pic ? { avatar: id, avatarPic: null } : { avatar: id }); S.user.avatar = id; S.user.pic = null; refreshProfile(); } }, h('img', { src: avUrl(id), alt: id })); }))),
    h('div', { class: 'lb-xprow', id: 'lb-profxp' }, h('b', null, 'LV ' + (S.acctStats ? S.acctStats.level : 1)), h('span', { class: 'lb-xptrack' }, h('i', { style: 'width:' + Math.max(2, S.acctStats ? S.acctStats.xpPct : 0) + '%' })), h('small', null, S.acctStats ? S.acctStats.xp + ' / ' + S.acctStats.nextXp + ' XP' : '')),
    h('div', { class: 'lb-stats' }, h('div', { class: 'panel panel--inset' }, h('b', { class: net > 0 ? 'up' : net < 0 ? 'down' : '' }, fm(net, 'cents', { signed: true })), h('small', null, 'Net')),
      h('div', { class: 'panel panel--inset' }, h('b', null, st.nights ?? st.nightsPlayed ?? (p.recent || []).length), h('small', null, 'Nights')), h('div', { class: 'panel panel--inset' }, h('b', null, st.hands ?? st.handsPlayed ?? 0), h('small', null, 'Hands'))),
    recent.length ? h('div', { class: 'lb-rows' }, recent.map((r) => h('div', { class: 'lb-row' }, h('div', null, h('div', { class: 't' }, r.name || r.tableName || r.nightId), h('div', { class: 's' }, r.date || '')), h('b', { class: r.net > 0 ? 'up' : 'down' }, fm(r.net, r.unit || 'cents', { signed: true }))))) : null,
    achSection(),
    h('div', { class: 'lb-field' }, h('label', null, 'Sound'), (() => { const on = () => !(window.PPSound && window.PPSound.muted); const b = h('button', { type: 'button', class: 'btn btn--secondary', id: 'lb-sound', onclick: () => { const t = document.getElementById('sound-toggle'); if (t) t.click(); else if (window.PPSound) window.PPSound.setMuted(on()); b.textContent = on() ? 'Sound: on' : 'Sound: off'; } }, on() ? 'Sound: on' : 'Sound: off'); return b; })()),
    h('div', { class: 'lb-field' }, h('label', null, 'Change PIN'), h('div', { class: 'lb-two' }, oldPin, newPin)), msg,
    h('div', { class: 'acts' }, h('button', { class: 'btn btn--secondary', onclick: () => { if (!/^\d{4,6}$/.test(newPin.value)) { msg.textContent = 'New PIN must be 4 to 6 digits.'; return; } S.onError = (m) => { msg.textContent = m; }; emit('pin_change', { oldPin: oldPin.value, newPin: newPin.value }); } }, 'Save PIN'), h('button', { class: 'btn btn--primary', onclick: closeModal }, 'Done')));
  drawAch(); renderAchHint();
}

// ── settle-up ─────────────────────────────────────────────────────
function viewSettle(d) {
  d = d || S.night; if (!d) return show('lobby');
  const unit = (d.table && d.table.unit) || 'cents';
  const players = (d.players || []).slice().sort((a, b) => b.net - a.net);
  const tid = d.tableId || (d.table && d.table.id) || String(d.nightId || '').split('_').pop();
  setMain(scrollWrap(h('div', { class: 'lb-settle' },
    h('div', { class: 'hd' }, h('span', { class: 'lb-eyebrow' }, (d.table && d.table.name) || 'The Ping'), h('h1', { id: 'lb-settle-h' }, 'Night closed')),
    h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Final results'), players.map((p, i) => h('div', { class: 'lb-net', 'data-key': p.key },
      h('span', { class: 'rk' }, i + 1), h('img', { src: avSrc(p), alt: '' }),
      h('div', { class: 'nm' }, p.display || p.key, h('div', { class: 'sub' }, 'In ' + fm((p.buyIns || 0) + (p.rebuys || 0), unit) + '  /  Out ' + fm(p.cashedOut, unit))),
      h('span'), h('span', { class: 'amt ' + (p.net > 0 ? 'up' : p.net < 0 ? 'down' : '') }, fm(p.net, unit, { signed: true }))))),
    h('div', { class: 'lb-copy', style: 'margin:var(--p12) 0' }, modeNote(d.table && d.table.mode)),
    h('div', { class: 'lb-btns' },
      h('button', { class: 'btn btn--secondary', id: 'lb-copytext', onclick: () => copy(d.text || '', 'Results') }, 'Copy as text'),
      h('button', { class: 'btn btn--secondary', id: 'lb-clone', onclick: () => { S.onError = (m) => toast(m); emit('table_clone', { tableId: tid }); } }, 'New table, same settings'),
      h('button', { class: 'btn btn--primary', id: 'lb-back', onclick: () => { S.night = null; show('lobby'); } }, 'Back to lobby')))));
}

// ── host drawer ───────────────────────────────────────────────────
function hostUi(on) {
  closeDrawer();
  if (hostBtn) { hostBtn.remove(); hostBtn = null; }
  const plate = document.querySelector('.blinds-plate');
  if (plate) { plate.classList.toggle('editable', !!on); plate.title = on ? 'Change blinds' : ''; }
  if (!on) return;
  const slot = $('host-slot'); if (!slot) return;
  hostBtn = h('button', { class: 'btn btn--secondary btn--sm', id: 'host-btn', type: 'button', onclick: toggleDrawer }, 'Host'); slot.append(hostBtn);
}
let drawerPoll = null, blindsEl = null, blindsFor = null;
function closeDrawer() {
  if (hostDrawer) { hostDrawer.remove(); hostDrawer = null; }
  blindsEl = null; blindsFor = null;
  clearInterval(drawerPoll); drawerPoll = null;
  document.removeEventListener('pointerdown', drawerOutside, true);
  document.removeEventListener('keydown', drawerEsc, true);
}
function drawerOutside(e) {
  if (!hostDrawer || hostDrawer.contains(e.target) || (hostBtn && hostBtn.contains(e.target))) return;
  closeDrawer();
}
function drawerEsc(e) { if (e.key === 'Escape') closeDrawer(); }
function toggleDrawer() {
  if (hostDrawer) { closeDrawer(); return; }
  const t = S.cur; if (!t) return; const id = tId(t);
  emit('table_preview', { code: id });
  hostDrawer = h('div', { class: 'host-drawer panel', id: 'host-drawer' }); drawDrawer(); document.body.append(hostDrawer);
  drawerPoll = setInterval(() => { if (S.cur) emit('table_preview', { code: tId(S.cur) }); }, 2000);
  document.addEventListener('pointerdown', drawerOutside, true);
  document.addEventListener('keydown', drawerEsc, true);
}
// Host drawer blinds editor. The two boxes are AmountInputs; the drawer re-renders on every table_info, so this keeps one
// live editor per table and calls update(t): server blinds flow into the boxes unless the host has touched them (S2-8).
// "Blinds set" appears only once the server's blinds equal what was sent.
function blindsEditor(t, id, unit) {
  const MAX_UNITS = 100000000;
  const cur = () => (S.cur && tId(S.cur) === id && S.cur.blinds) || t.blinds || { sb: t.sb, bb: t.bb };
  const c0 = cur();
  const mkf = (v, lo, label, eid) => { const f = AmountInput({ units: v, min: lo, max: MAX_UNITS, unit, scale: 'ladder', compact: true, label, rangeLabel: label }); f.input.id = eid; return f; };
  const sbF = mkf(c0.sb, 1, 'Small blind', 'host-sb'), bbF = mkf(c0.bb, 2, 'Big blind', 'host-bb');
  const note = h('div', { class: 'lb-muted', id: 'host-blinds-msg' });
  let touched = false, pending = null;
  const markTouched = () => { touched = true; if (!pending) note.textContent = ''; };
  sbF.input.addEventListener('input', markTouched); bbF.input.addEventListener('input', markTouched);
  const save = () => {
    const sb = sbF.value(), bb = bbF.value();
    if (sb === null || bb === null) { if (sb === null) sbF.submit(); if (bb === null) bbF.submit(); note.textContent = 'Fix the highlighted blind first.'; return; }
    if (sb >= bb) { note.textContent = 'Small blind must be less than the big blind.'; return; }
    pending = { sb, bb }; note.textContent = 'Sending...';
    S.onError = (m) => { pending = null; note.textContent = m; };
    emit('table_update', { tableId: id, patch: { blinds: { sb, bb } } });
  };
  [sbF, bbF].forEach((f) => f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));
  const update = (nt) => {
    const c = (nt && (nt.blinds || (nt.sb && { sb: nt.sb, bb: nt.bb }))) || cur();
    if (pending && c.sb === pending.sb && c.bb === pending.bb) {
      note.textContent = 'Blinds set to ' + fm(c.sb, unit) + ' / ' + fm(c.bb, unit) + '. A hand in progress keeps the old blinds; the new ones start next hand.';
      pending = null; touched = false;
    }
    if (!touched && !sbF.isDirty() && !bbF.isDirty()) { sbF.set(c.sb, { source: 'server' }); bbF.set(c.bb, { source: 'server' }); }
  };
  const el = h('div', { class: 'lb-stack', style: 'gap:var(--p8)' },
    h('div', { class: 'lb-label' }, 'Blinds'),
    h('div', { style: 'display:grid;grid-template-columns:1fr auto 1fr;gap:var(--p8);align-items:start' }, sbF.el, h('span', { style: 'font-size:var(--fs-1)' }, '/'), bbF.el),
    h('button', { class: 'btn btn--secondary btn--sm btn--block', id: 'host-blinds-save', type: 'button', onclick: save }, 'Set blinds'),
    note);
  return { el, update };
}
document.addEventListener('click', (e) => {
  if (!hostBtn || !e.target.closest || !e.target.closest('.blinds-plate')) return;
  if (!hostDrawer) toggleDrawer();
  setTimeout(() => { const i = $('host-sb'); if (i) { i.focus(); i.select(); } }, 60);
});
function drawDrawer(confirmEnd) {
  if (!hostDrawer || !S.cur) return;
  const t = S.cur, id = tId(t), info = S.info[id], paused = t.state === 'paused';
  const unit = t.unit || unitOf(t.mode);
  const blinds = (blindsFor === id && blindsEl) ? (blindsEl.update(t), blindsEl.el) : (blindsFor = id, blindsEl = blindsEditor(t, id, unit), blindsEl.el);
  const title = h('h4', { class: 'panel__title' }, 'Host controls', h('small', null, t.name + '  /  ' + id),
    h('button', { class: 'panel__close host-x', id: 'host-close', type: 'button', 'aria-label': 'Close host controls', onclick: closeDrawer }, '\u00d7'));
  const above = [
    h('div', { class: 'lb-btns' },
      h('button', { class: 'btn btn--secondary btn--sm', id: 'host-start', onclick: () => emit('table_start', { tableId: id }) }, 'Start'),
      h('button', { class: 'btn btn--secondary btn--sm', id: 'host-pause', onclick: () => emit('table_pause', { tableId: id, paused: !paused }) }, paused ? 'Resume table' : 'Pause table'))];
  const below = [
    h('hr', { class: 'divider' }),
    h('div', { class: 'lb-label' }, 'Players'),
    ...((info && info.seated) || []).map((p) => h('div', { class: 'lb-seat panel panel--inset' }, h('img', { src: avSrc(p), alt: '' }), h('div', null, h('b', null, p.display || p.key), h('span', null, fm(p.stack, unit))),
      p.key !== myKey() ? h('button', { class: 'btn btn--danger btn--sm', onclick: () => emit('table_kick', { tableId: id, key: p.key }) }, 'Kick') : null))];
  const foot = h('div', { class: 'host-foot' },
    confirmEnd ? h('div', { class: 'lb-stack', style: 'gap:var(--p10)' }, h('div', { class: 'note' }, 'End the night? The current hand finishes, then everyone cashes out.'),
      h('div', { class: 'lb-btns' }, h('button', { class: 'btn btn--secondary btn--sm', onclick: () => drawDrawer(false) }, 'Keep playing'), h('button', { class: 'btn btn--danger btn--sm', id: 'host-end-confirm', onclick: () => { emit('table_end_night', { tableId: id }); toggleDrawer(); } }, 'End night'))) :
      h('button', { class: 'btn btn--danger btn--sm btn--block', id: 'host-end', onclick: () => drawDrawer(true) }, 'End night'));
  // Every table_info redraws this drawer, and they arrive while the host is typing. The blinds editor must stay in the page
  // through a redraw: taking a focused input out of the document drops the cursor, so the host could not finish a number.
  // The editor lives in a .host-body that is kept too; only the nodes around the editor are replaced.
  const body = blinds.parentNode;
  if (body && body.parentNode === hostDrawer && body.classList.contains('host-body')) {
    while (body.firstChild !== blinds) body.firstChild.remove();
    while (body.lastChild !== blinds) body.lastChild.remove();
    blinds.before(...above); blinds.after(...below);
    while (hostDrawer.firstChild !== body) hostDrawer.firstChild.remove();
    while (hostDrawer.lastChild !== body) hostDrawer.lastChild.remove();
    body.before(title); body.after(foot);
  } else hostDrawer.replaceChildren(title, h('div', { class: 'host-body' }, ...above, blinds, ...below), foot);
}

// ── socket events ─────────────────────────────────────────────────
function onAuthOk({ account, token }) {
  S.resumeBusy = false; S.user = account; clearInterval(lockT);
  if (token) saveSession(account.key, token);
  const pref = account.prefs && account.prefs.currency;
  if (pref === 'usd' || pref === 'chips' || pref === 'auto') window.Money.setPref(pref, true);
  emit('profile_get', {});
  if (S.view === 'signin' || !S.booted) {
    S.booted = true;
    const last = (() => { try { return JSON.parse(LS.get('ping.table') || 'null'); } catch { return null; } })();
    if (S.deep && !(last && last.id && String(S.deep).toUpperCase() === String(last.id).toUpperCase())) { const c = S.deep; S.deep = null; show('lobby'); openJoin(c); }
    else if (last && last.id) { S.deep = null; S.rebind = null; S.rebinding = last.id; show('lobby'); emit('table_join', { tableId: last.id, buyIn: last.buyIn || 0 }); }
    else show('lobby');
  } else renderTop();
}
function bind() {
  const s = getSock(); if (!s) return;
  s.on('connect', () => { if (!S.resumeBusy && (S.user || loadSession())) tryResume(); });
  s.on('auth_ok', onAuthOk);
  s.on('auth_error', ({ code, retryMs, message } = {}) => {
    S.resumeBusy = false;
    if (code === 'bad_session' || (!S.user && loadSession() && S.view !== 'signin')) { clearSession(); S.user = null; show('signin'); if (code !== 'bad_session') S.signErr && S.signErr(code, retryMs, message); return; }
    if (S.view === 'signin') S.signErr && S.signErr(code, retryMs, message); else if (S.onError) S.onError(message || 'PIN not accepted');
  });
  s.on('auth_out', () => { clearSession(); S.user = null; S.profile = null; S.cur = null; if (window.PingGame && window.PingGame.isIn && window.PingGame.isIn()) window.PingGame.leave(); show('signin'); });
  s.on('account:stats', (st) => { S.acctStats = st; const x = $('lb-profxp'); if (x) { x.querySelector('b').textContent = 'LV ' + st.level; x.querySelector('i').style.width = Math.max(2, st.xpPct) + '%'; x.querySelector('small').textContent = st.xp + ' / ' + st.nextXp + ' XP'; } });
  s.on('profile', (p) => {
    S.profile = p; const mine = S.user && p.key === S.user.key;
    if (mine) { if (p.display) S.user.display = p.display; S.user.pic = p.pic || null; if (p.avatar) S.user.avatar = p.avatar; }
    refreshProfile();
    const ni = $('lb-dispname'), nm = $('lb-namemsg');
    if (mine && S.pendingName && p.display === S.pendingName) { S.pendingName = null; if (ni) ni.value = p.display; if (nm) { nm.classList.add('ok'); nm.textContent = 'Name saved.'; } }
  });
  s.on('profile_error', ({ field, message } = {}) => {
    S.pendingName = null;
    const el = $(field === 'display' ? 'lb-namemsg' : 'lb-photomsg');
    if (el) { el.classList.remove('ok'); el.textContent = message || 'Could not save that.'; } else toast(message || 'Could not save that.');
  });
  s.on('self_changed', (v) => { if (!S.user || !v || v.key !== S.user.key) return; Object.assign(S.user, { display: v.display, avatar: v.avatar, pic: v.pic || null }); refreshProfile(); });
  s.on('account_changed', () => { if (!S.user) return; if (S.view === 'lobby') { emit('get_leaderboard', {}); emit('social:feed'); emit('social:biggest'); emit('lobby_list', {}); } if (S.view === 'share' && S.arg) emit('table_preview', { code: S.arg }); });
  s.on('wallet', (w) => { S.wallet = w; renderTop(); });
  s.on('money', (m) => { if (!m) return; if (S.user && Number.isFinite(m.bank)) S.user.bankChips = m.bank; if (m.wallet) S.wallet = m.wallet; renderTop(); });
  s.on('social:feed', onFeed);
  s.on('social:biggest', onBest);
  s.on('achv:state', (v) => { S.achv = v; drawAch(); renderAchHint(); });
  s.on('achv:unlocked', () => { if (S.achv) { S.achv.unseen = (S.achv.unseen || 0) + 1; } renderAchHint(); if ($('lb-ach')) emit('achv:state', {}); });
  s.on('lobby_tables', ({ tables }) => { S.tables = tables || []; if (S.view === 'lobby') drawLists(); });
  s.on('tables_mine', ({ tables, nightNet }) => { S.mine = tables || []; S.net = nightNet || {}; if (S.view === 'lobby') drawLists(); });
  s.on('leaderboard_data', ({ entries, me }) => { S.board = entries || []; S.boardMe = me || null; if (S.view === 'lobby') drawLists(); });
  s.on('table_created', ({ table }) => { S.cur = table; S.sharePick = null; S.shareErr = ''; S.onError = null; S.info[tId(table)] = S.info[tId(table)] || { table, seated: [], openSeats: table.seats }; show('share', tId(table)); });
  s.on('table_info', onInfo);
  s.on('table_joined', (p) => {
    S.cur = p.table; S.onError = null; S.rebinding = null; S.sharePick = null; closeModal();
    LS.set('ping.table', JSON.stringify({ id: p.tableId || tId(p.table), buyIn: p.stack }));
    root && root.classList.remove('on');
    if (window.PingGame && window.PingGame.enter) window.PingGame.enter(p);
    hostUi(tHost(p.table) === myKey() || isAdmin());
    mountToggles();
  });
  s.on('table_left', () => { LS.del('ping.table'); S.cur = null; hostUi(false); emit('tables_mine', {}); });
  s.on('table_event', (ev) => {
    if (!ev) return;
    const t = S.cur && tId(S.cur) === (ev.tableId || tId(ev.table || {}));
    if (t) {
      if (ev.table) S.cur = Object.assign(S.cur, ev.table);
      if (ev.kind === 'paused') S.cur.state = ev.paused ? 'paused' : 'open';
      if (ev.kind === 'host' || ev.kind === 'host_changed') { S.cur.hostKey = ev.key || ev.hostKey; hostUi(S.cur.hostKey === myKey() || isAdmin()); }
      if (ev.kind === 'kicked' && ev.key === myKey()) { LS.del('ping.table'); toast('You were removed from the table'); }
      if (hostDrawer) { emit('table_preview', { code: tId(S.cur) }); drawDrawer(); }
    }
    if (S.view === 'share' && S.arg === (ev.tableId || '')) emit('table_preview', { code: S.arg });
  });
  s.on('settle_up', (d) => {
    S.night = d; LS.del('ping.table');
    if (window.PingGame && window.PingGame.isIn && window.PingGame.isIn()) window.PingGame.leave();
    S.cur = null; hostUi(false); root && root.classList.add('on'); show('settle', d);
  });
  s.on('ok', ({ what } = {}) => { if (what === 'pin') { toast('PIN changed'); closeModal(); } });
  s.on('error', (e0 = {}) => {
    const { code } = e0, message = window.PingUI ? PingUI.errorText(e0, modeFor(S.view === 'create' && S.form ? S.form.unit : (S.cur && S.cur.unit) || 'chips')) : e0.message;
    if (code === 'taken_over') { // this seat was taken over by another tab or device: leave the table here
      if (window.PingGame && PingGame.isIn && PingGame.isIn()) PingGame.leave();
      Lobby.onGameLeft(); toast(message || 'This seat is now open on another device'); return;
    }
    if (S.rebinding) { S.rebinding = null; LS.del('ping.table'); toast('Could not return to your table'); return; }
    if (S.pendingJoin && !S.onError) { S.pendingJoin = null; toast(message || 'No table with that code'); return; }
    if (S.onError) { const f = S.onError; if (S.pendingJoin) S.pendingJoin = null; f(message || 'Something went wrong'); } else if (S.user && message) toast(message);
  });
}

// ── public API ────────────────────────────────────────────────────
const Lobby = {
  show: (name, arg) => { if (name === 'profile') { if (!S.user) return; if (S.view === 'signin') show('lobby'); const over = !root.classList.contains('on'); openProfile(); if (over) root.classList.add('lb-overlay'); return; } if (name === 'lobby' || !name) { S.cur = null; hostUi(false); LS.del('ping.table'); } return show(name || 'lobby', arg); },
  user: () => (S.user ? { key: S.user.key, display: S.user.display, avatar: S.user.avatar, pic: S.user.pic || null, prefs: S.user.prefs || {}, isAdmin: !!S.user.isAdmin } : null),
  onGameLeft: () => { S.cur = null; LS.del('ping.table'); hostUi(false); if (S.user) show('lobby'); },
  signOut,
  mount: (el) => { ensureRoot(); root.classList.add('lb-host'); el.append(root); },
};
window.Lobby = Lobby;

function init() {
  ensureRoot();
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9]{6})/) || location.search.match(/[?&]t=([A-Za-z0-9]{6})/) || location.hash.match(/^#\/t\/([A-Za-z0-9]{6})/);
  if (m) { S.deep = code6(m[1]); history.replaceState(null, '', '/' + (location.hash || '')); }
  if (window.Money) window.Money.onSave = (mode) => { if (S.user) emit('profile_update', { prefs: { currency: mode } }); };
  mountToggles();
  bind();
  if (window.Shell && window.Shell.registerScreen) window.Shell.registerScreen('lobby', (el) => Lobby.mount(el));
  if (tryResume()) { root.classList.add('on'); setMain(h('div', { class: 'lb-center' }, h('div', { class: 'lb-eyebrow' }, 'Reconnecting'))); setTimeout(() => { if (!S.user) { S.resumeBusy = false; show('signin'); } }, 7000); }
  else show('signin');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
