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
function fm(u, unit, o) {
  if (u == null || Number.isNaN(u)) return '-';
  if (window.Money) return window.Money.fmt(u, Object.assign({ unit }, o));
  const s = (o && o.signed && u > 0 ? '+' : '') + (u < 0 ? '-' : '');
  const a = Math.abs(u);
  return unit === 'chips' ? s + a.toLocaleString('en-US') : s + '$' + (a % 100 ? (a / 100).toFixed(2) : (a / 100).toLocaleString('en-US'));
}
function parseAmt(text, unit) {
  if (window.Money && window.Money.parse) { window.Money.setUnit?.(unit); const v = window.Money.parse(text); return v == null || !Number.isFinite(v) ? null : Math.round(v); }
  const s = String(text).replace(/[$,\s]/g, ''); if (!/^\d*\.?\d+$/.test(s)) return null;
  return unit === 'chips' ? Math.round(parseFloat(s)) : Math.round(parseFloat(s) * 100);
}
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
  const t = h('div', { class: 'lb-toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200);
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
    h('button', { class: 'lb-link', id: 'lb-signout', onclick: signOut }, 'Sign out'));
  mountToggles();
  renderAchHint();
}
function mountToggles() {
  if (!window.Money || !window.Money.toggleEl) return;
  document.querySelectorAll('[data-money-toggle]').forEach((slot) => { if (!slot.firstChild) slot.append(window.Money.toggleEl()); });
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
  window.Money && window.Money.setUnit && window.Money.setUnit('cents');
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
    const name = h('input', { class: 'text-input', id: 'lb-name', type: 'text', maxlength: 16, autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Your name', value: LS.get('ping.name') || '' });
    const pin = h('input', { class: 'text-input', id: 'lb-pin', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: tab === 'in' ? 'current-password' : 'new-password', placeholder: '4 to 6 digits',
      oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); } });
    const room = h('input', { class: 'text-input', id: 'lb-room', type: 'password', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Room password' });
    const submit = h('button', { class: 'lb-btn big', id: 'lb-submit', type: 'submit' }, tab === 'in' ? 'Sign in' : claim ? 'Claim name' : 'Create account');
    const fieldsAv = tab === 'up' ? h('div', { class: 'lb-field' }, h('label', null, 'Avatar'),
      h('div', { class: 'lb-avatars', id: 'lb-avatars' }, Array.from({ length: 12 }, (_, i) => { const id = 'a' + String(i + 1).padStart(2, '0');
        return h('button', { type: 'button', 'data-av': id, class: id === avatar ? 'on' : '', onclick: (e) => { avatar = id; LS.set('ping.avatar', id); wrap.querySelectorAll('.lb-avatars button').forEach((b) => b.classList.toggle('on', b.dataset.av === id)); } }, h('img', { src: avUrl(id), alt: id })); }))) : null;
    const form = h('form', { class: 'lb-sign lb-frame', id: 'lb-signform', novalidate: true,
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
      h('div', { class: 'lb-seg tabs', role: 'tablist' },
        h('button', { type: 'button', 'data-tab': 'in', class: tab === 'in' ? 'on' : '', onclick: () => { tab = 'in'; claim = false; draw(); } }, 'Sign in'),
        h('button', { type: 'button', 'data-tab': 'up', class: tab === 'up' ? 'on' : '', onclick: () => { tab = 'up'; draw(); } }, 'New account')),
      claim ? h('div', { class: 'lb-notice', id: 'lb-claim' }, 'This name is already on the books. Set a PIN to claim it, and enter the room password.') : null,
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
  const codeIn = h('input', { class: 'text-input code', id: 'lb-code', maxlength: 9, placeholder: 'CODE', autocomplete: 'off',
    oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const jerr = h('div', { class: 'lb-err', id: 'lb-joinerr' });
  const go = () => { const c = code6(codeIn.value); if (c.length < 6) { jerr.textContent = 'Codes are 6 characters.'; return; } jerr.textContent = ''; S.onError = (m) => { jerr.textContent = m; }; openJoin(c); };
  setMain(scrollWrap(h('div', { class: 'lb-wrap' }, h('div', { class: 'lb-cols' },
    h('div', { class: 'lb-stack' },
      h('section', { class: 'lb-card' }, h('h2', null, 'Your tables'), h('div', { id: 'lb-mine', class: 'lb-rows' })),
      h('section', { class: 'lb-card' }, h('h2', null, 'Open tables', h('small', null, 'Listed by their hosts')), h('div', { id: 'lb-open', class: 'lb-rows' }))),
    h('div', { class: 'lb-stack' },
      h('section', { class: 'lb-best', id: 'lb-best', 'aria-label': 'Biggest win today' }),
      h('button', { class: 'lb-btn big', id: 'lb-create-btn', onclick: () => show('create') }, 'Create table'),
      h('section', { class: 'lb-card' }, h('h2', null, 'Join by code'), h('div', { class: 'lb-stack', style: 'gap:var(--p12)' }, codeIn, h('button', { class: 'lb-btn blue full', id: 'lb-join-btn', onclick: go }, 'Join'), jerr)),
      h('section', { class: 'lb-card' }, h('h2', null, 'Leaderboard', h('small', null, 'Lifetime net')), h('div', { id: 'lb-board' })),
      h('section', { class: 'lb-card lb-feed-card' }, h('h2', null, 'Around the table', h('small', null, 'Live')), h('div', { id: 'lb-feed', class: 'lb-feed' })))))));
  drawLists(); drawFeed(); drawBest(); emit('social:feed'); emit('social:biggest');
}
// ── activity feed ─────────────────────────────────────────────────
const FEED_ICON = { bigwin: 'vp-chip', bonus: 'ballot-cherry', levelup: 'vp-horseshoe', join: 'ping-hand', feature: 'i-pinged' };
let feedSkew = 0;
function feedBold(t) { return h('b', null, String(t == null ? '' : t).replace(/\*/g, '')); }
function feedText(e) {
  const nm = feedBold(e.name || 'Someone');
  if (e.kind === 'bigwin') {
    const amt = typeof e.amountCents === 'number' ? (e.unit === 'chips' ? e.amountCents.toLocaleString('en-US') + ' chips' : fm(e.amountCents, 'cents')) : '';
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
        h('div', null, h('div', { class: 't' }, t.name, tHost(t) === myKey() ? h('span', { class: 'lb-tag' }, 'Host') : null, t.state === 'paused' ? h('span', { class: 'lb-tag' }, 'Paused') : null, ended ? h('span', { class: 'lb-tag' }, 'Ended') : null),
          h('div', { class: 's' }, tableLine(t), n != null ? h('span', null, '  /  Tonight ', h('b', { class: n > 0 ? 'up' : n < 0 ? 'down' : '' }, fm(n, unit, { signed: true }))) : null)),
        ended ? h('button', { class: 'lb-btn sm blue', onclick: () => emit('night_get', { nightId: t.nightId }) }, 'Settle up')
          : h('button', { class: 'lb-btn sm', 'data-resume': tId(t), onclick: () => { S.resume = tId(t); openJoin(tId(t)); } }, 'Resume'));
    }) : [h('div', { class: 'lb-empty' }, 'No tables yet. Create one, or join with a code.')]));
  }
  if (open) {
    const list = S.tables.filter((t) => !t.isPrivate && t.state !== 'ended');
    open.replaceChildren(...(list.length ? list.map((t) => h('div', { class: 'lb-row', 'data-table': tId(t) },
      h('div', null, h('div', { class: 't' }, t.name, t.host ? h('span', { class: 'lb-muted' }, 'hosted by ' + (t.host.display || t.host.key)) : null), h('div', { class: 's' }, tableLine(t))),
      h('button', { class: 'lb-btn sm blue', onclick: () => openJoin(tId(t)) }, 'Join'))) : [h('div', { class: 'lb-empty' }, 'No open tables right now.')]));
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
function openModal(...kids) {
  closeModal(); ensureRoot();
  const sc = h('div', { class: 'lb-scrim', onmousedown: (e) => { if (e.target === sc) closeModal(); } }, h('div', { class: 'lb-modal lb-frame', role: 'dialog' }, ...kids));
  S.modalKey = (e) => { if (e.key === 'Escape') closeModal(); }; document.addEventListener('keydown', S.modalKey);
  root.append(sc); return sc;
}

// ── settings summary card ─────────────────────────────────────────
function settingsCard(t) {
  const unit = t.unit || unitOf(t.mode), bb = t.blinds ? t.blinds.bb : t.bb, sb = t.blinds ? t.blinds.sb : t.sb, bi = t.buyIn || {};
  const cell = (k, v) => h('div', null, h('small', null, k), h('b', null, v));
  return h('div', { class: 'lb-set', id: 'lb-settings' },
    cell('Mode', modeLabel(t.mode)), cell('Blinds', fm(sb, unit) + ' / ' + fm(bb, unit)),
    cell('Buy-in', fm(bi.min, unit) + ' to ' + fm(bi.max, unit)), cell('Seats', t.seats),
    cell('Clock', t.actionTimerSec ? t.actionTimerSec + 's' : 'None'), cell('Host', (t.host && t.host.display) || (t.hostKey || '')),
    t.blindIncrease && t.blindIncrease.enabled ? cell('Blinds rise', 'every ' + t.blindIncrease.everyMin + ' min') : null, cell('Rebuys', t.rebuys === false ? 'Off' : 'On'));
}

// ── buy-in picker (slider + typed) ────────────────────────────────
function buyInPicker(t, mySettled) {
  const unit = t.unit || unitOf(t.mode), bi = t.buyIn;
  let fund = t.mode;
  const bankOf = (f) => (f === 'chips' ? (S.user && (S.user.bankChips ?? S.user.chips)) : (S.wallet ? S.wallet.play : null));
  const hiOf = (bk) => (bk != null && Number.isFinite(bk) ? Math.max(bi.min, Math.min(bi.max, bk)) : bi.max);
  let bank = bankOf(fund), hi = hiOf(bank);
  let vals = ladder(unit, bi.min, hi, [bi.default]);
  let val = Math.min(hi, Math.max(bi.min, bi.default));
  window.Money && window.Money.setUnit && window.Money.setUnit(unit);
  const range = h('input', { type: 'range', min: 0, max: vals.length - 1, step: 1, value: nearIdx(vals, val), id: 'lb-buyin-range', 'aria-label': 'Buy-in' });
  const fill = h('div', { class: 'fill' });
  const typed = h('input', { class: 'text-input', id: 'lb-buyin-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: plain(val) });
  const msg = h('div', { class: 'lb-err', id: 'lb-buyin-err' });
  function plain(v) { return window.Money ? window.Money.fmt(v, { symbol: false }).replace(/,/g, '') : String(v); }
  const paint = () => { const a = range.value / Math.max(1, vals.length - 1); fill.style.left = 'var(--p8)'; fill.style.width = 'calc((100% - var(--p16)) * ' + a + ')'; };
  range.addEventListener('input', () => { val = vals[+range.value]; typed.value = plain(val); msg.textContent = ''; paint(); drawBal(); });
  const commit = () => {
    const v = parseAmt(typed.value, unit);
    if (v == null) { msg.textContent = 'Enter an amount.'; return false; }
    val = Math.min(hi, Math.max(bi.min, v)); typed.value = plain(val); range.value = nearIdx(vals, val); paint();
    msg.textContent = v !== val ? 'Buy-in is ' + fm(bi.min, unit) + ' to ' + fm(hi, unit) + '.' : ''; drawBal(); return true;
  };
  typed.addEventListener('change', commit); typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  paint();
  const balLine = h('div', { class: 'lb-muted', id: 'lb-fund-bal' });
  const drawBal = () => {
    const cross = fund !== t.mode;
    balLine.textContent = bank == null ? '' : (fund === 'play' ? 'Your Play $: ' + fm(bank, 'cents') : 'Your bank: ' + fm(bank, 'chips')) + (cross ? '. This buy-in costs ' + (fund === 'play' ? fm(val, 'cents') : fm(val, 'chips')) + ' (1 chip = $0.01).' : '');
  };
  const fundBtn = (f, label) => h('button', { type: 'button', class: 'lb-btn' + (fund === f ? '' : ' blue'), id: 'lb-fund-' + f, onclick: () => {
    if (fund === f) return; fund = f; bank = bankOf(fund); hi = hiOf(bank);
    vals = ladder(unit, bi.min, hi, [bi.default]); val = Math.min(hi, Math.max(bi.min, val)); range.max = vals.length - 1; range.value = nearIdx(vals, val); typed.value = plain(val); msg.textContent = '';
    fundRow.replaceChildren(fundBtn('chips', 'Chips'), fundBtn('play', 'Play $')); paint(); drawBal();
  } }, label);
  const fundRow = h('div', { class: 'lb-field', id: 'lb-fund' }, fundBtn('chips', 'Chips'), fundBtn('play', 'Play $'));
  drawBal();
  const night = mySettled != null ? h('div', { class: 'lb-muted' }, 'Your night so far: ', h('b', { class: mySettled > 0 ? 'up' : mySettled < 0 ? 'down' : '' }, fm(mySettled, unit, { signed: true }))) : null;
  const el = h('div', { class: 'lb-stack', style: 'gap:var(--p14)' },
    h('div', { class: 'lb-field' }, h('label', null, 'Buy-in'), h('div', { class: 'lb-join' }, typed, h('span'))),
    h('div', { class: 'lb-slider' }, h('div', { class: 'trk' }), fill, range),
    h('div', { class: 'lb-ends' }, h('span', null, fm(bi.min, unit)), h('span', null, fm(hi, unit))), msg, night,
    fundRow, balLine);
  return { el, get: () => (commit() ? val : null), getFund: () => fund, msg };
}

// ── join / buy-in modal ───────────────────────────────────────────
function openJoin(code) {
  code = (S.tables.concat(S.mine).find((t) => tId(t) === String(code).toUpperCase()) ? String(code).toUpperCase() : code6(code));
  if (!getSock()) return;
  S.pendingJoin = code; emit('table_preview', { code });
}
function onInfo(info) {
  const t = info.table; if (!t) return;
  S.info[tId(t)] = info;
  if (hostDrawer && S.cur && tId(S.cur) === tId(t)) drawDrawer();
  if (S.view === 'share' && S.arg === tId(t)) { drawShare(); return; }
  if (S.pendingJoin && S.pendingJoin === tId(t)) {
    S.pendingJoin = null; S.onError = null;
    const me = (info.seated || []).find((p) => p.key === myKey());
    if (S.resume === tId(t) || S.rebind === tId(t)) { S.resume = S.rebind = null; if (me) { emit('table_join', { tableId: tId(t), buyIn: me.stack || t.buyIn.default }); return; } }
    if (t.state === 'ended') { emit('night_get', { nightId: t.nightId }); return; }
    if (tHost(t) === myKey() && !me && S.view !== 'share' && S.view !== 'signin') { show('share', tId(t)); return; }
    modalJoin(info, me);
  }
}
function modalJoin(info, me) {
  const t = info.table, id = tId(t), unit = t.unit || unitOf(t.mode);
  const pick = buyInPicker(t, S.net[id]);
  const err = h('div', { class: 'lb-err', id: 'lb-joinmsg' });
  const sit = h('button', { class: 'lb-btn', id: 'lb-sit', onclick: () => {
    const v = me ? (me.stack || t.buyIn.default) : pick.get(); if (v == null) return;
    sit.disabled = true; err.textContent = ''; S.onError = (m) => { sit.disabled = false; err.textContent = m; };
    emit('table_join', { tableId: id, buyIn: v, fund: pick.getFund() });
  } }, me ? 'Return to seat' : 'Sit down');
  openModal(
    h('div', null, h('span', { class: 'lb-eyebrow' }, 'Table ' + id), h('h3', null, t.name)),
    settingsCard(t),
    h('div', { class: 'lb-seatlist' }, seatCells(info)),
    me ? h('div', { class: 'lb-muted' }, 'You are already seated here with ' + fm(me.stack, unit) + '.') : pick.el,
    h('div', { class: 'lb-copy' }, modeNote(t.mode)), err,
    h('div', { class: 'acts' }, h('button', { class: 'lb-btn blue', id: 'lb-cancel', onclick: closeModal }, 'Cancel'), sit));
}
function seatCells(info) {
  const t = info.table, unit = t.unit || unitOf(t.mode);
  const cells = (info.seated || []).map((p) => h('div', { class: 'lb-seat' }, h('img', { src: avSrc(p), alt: '' }), h('div', null, h('b', null, p.display || p.key), h('span', null, fm(p.stack, unit)))));
  const open = Math.max(0, (info.openSeats ?? t.seats - cells.length));
  for (let i = 0; i < open; i++) cells.push(h('div', { class: 'lb-seat open' }, 'Open seat'));
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
  const host = h('div', { class: 'lb-form lb-card', id: 'lb-form' }), side = h('div', { class: 'lb-stack' });
  const grid = h('div', { class: 'lb-create' }, host, side);
  setMain(scrollWrap(h('div', { class: 'lb-wrap' }, h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('button', { class: 'lb-link', onclick: () => show('lobby') }, 'Back to lobby')), grid)));
  const draw = () => {
    const sc = mainEl.firstChild.scrollTop; host.replaceChildren(...formBody(f, draw, refreshSum).filter(Boolean)); side.replaceChildren(sumCard()); mainEl.firstChild.scrollTop = sc;
  };
  const sumCard = () => {
    const el = h('section', { class: 'lb-card lb-sum', id: 'lb-sum' }); S.sumEl = el; fillSummary(f, el);
    const err = h('div', { class: 'lb-err', id: 'lb-createerr' });
    const btn = h('button', { class: 'lb-btn big', id: 'lb-create-submit', onclick: () => submitCreate(f, err, btn) }, 'Create table');
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
    f.min < b.bb * 20 ? h('div', { class: 'lb-warn', id: 'lb-warn' }, 'Minimum buy-in is under 20 big blinds. Short stacks play fast.') : null,
    h('div', { class: 'lb-muted' }, 'Suggested buy-in: ' + fm(sug, u) + ' (100 big blinds).'),
    h('div', { class: 'lb-copy' }, modeNote(f.mode)));
}
function seg(opts, cur, onPick, id) {
  return h('div', { class: 'lb-seg', id }, opts.map(([v, label, sub]) => h('button', { type: 'button', 'data-v': String(v), class: String(v) === String(cur) ? 'on' : '', onclick: () => onPick(v) }, label, sub ? h('small', null, sub) : null)));
}
function formBody(f, redraw, sum) {
  const u = f.unit, g = (label, ...k) => h('div', { class: 'grp' }, h('span', { class: 'lb-label' }, label), ...k);
  const set = (k) => (v) => { f[k] = v; redraw(); };
  const modeSeg = seg([['play', 'Play $', 'fake money'], ['chips', 'Chips', 'bank chips']], f.mode, (m) => { if (m !== f.mode) { S.form = Object.assign(f, freshForm(m, f)); } redraw(); }, 'lb-mode');
  const name = h('input', { class: 'text-input', id: 'lb-tname', maxlength: 24, value: f.name, oninput: (e) => { f.name = e.target.value; sum(); } });
  // buy-in range
  const lo = 500, hi = u === 'chips' ? 1000000 : 50000, vals = ladder(u, lo, hi, [f.min, f.max, f.def]);
  const rl = h('input', { type: 'range', min: 0, max: vals.length - 1, step: 1, value: nearIdx(vals, f.min), 'aria-label': 'Minimum buy-in' });
  const rh = h('input', { type: 'range', min: 0, max: vals.length - 1, step: 1, value: nearIdx(vals, f.max), 'aria-label': 'Maximum buy-in' });
  const fill = h('div', { class: 'fill' });
  const plain = (v) => (u === 'chips' ? String(v) : '$' + (v % 100 ? (v / 100).toFixed(2) : v / 100));
  const inMin = h('input', { class: 'text-input', id: 'lb-bmin', value: plain(f.min), inputmode: 'decimal' }), inDef = h('input', { class: 'text-input', id: 'lb-bdef', value: plain(f.def), inputmode: 'decimal' }), inMax = h('input', { class: 'text-input', id: 'lb-bmax', value: plain(f.max), inputmode: 'decimal' });
  const n1 = Math.max(1, vals.length - 1);
  const paint = () => { const a = rl.value / n1, b = rh.value / n1; fill.style.left = 'calc(var(--p8) + (100% - var(--p16)) * ' + a + ')'; fill.style.width = 'calc((100% - var(--p16)) * ' + (b - a) + ')'; };
  const sync = () => { f.def = Math.min(f.max, Math.max(f.min, f.def)); inMin.value = plain(f.min); inMax.value = plain(f.max); inDef.value = plain(f.def); rl.value = nearIdx(vals, f.min); rh.value = nearIdx(vals, f.max); paint(); sum(); };
  rl.addEventListener('input', () => { if (+rl.value > +rh.value) rl.value = rh.value; f.min = vals[+rl.value]; sync(); });
  rh.addEventListener('input', () => { if (+rh.value < +rl.value) rh.value = rl.value; f.max = vals[+rh.value]; sync(); });
  const typedHook = (inp, key) => inp.addEventListener('change', () => {
    const v = parseAmt(inp.value, u); if (v != null && v >= 1) { f[key] = v; if (key === 'min' && f.max < v) f.max = v; if (key === 'max' && f.min > v) f.min = v; }
    sync();
  });
  typedHook(inMin, 'min'); typedHook(inDef, 'def'); typedHook(inMax, 'max'); paint();
  const b = blindsOf(f);
  const blindSeg = h('div', { class: 'lb-seg', id: 'lb-blinds' }, PRESETS[u].map((p, i) => h('button', { type: 'button', 'data-v': i, class: !f.custom && i === f.preset ? 'on' : '', onclick: () => { f.custom = false; f.preset = i; redraw(); } }, fm(p[0], u) + '/' + fm(p[1], u))),
    h('button', { type: 'button', 'data-v': 'custom', class: f.custom ? 'on' : '', onclick: () => { f.custom = true; f.csb = b.sb; f.cbb = b.bb; redraw(); } }, 'Custom'));
  const custom = f.custom ? h('div', { class: 'lb-two' },
    h('div', { class: 'lb-field' }, h('label', null, 'Small blind'), h('input', { class: 'text-input', id: 'lb-csb', value: plain(f.csb), onchange: (e) => { const v = parseAmt(e.target.value, u); if (v) f.csb = v; sum(); } })),
    h('div', { class: 'lb-field' }, h('label', null, 'Big blind'), h('input', { class: 'text-input', id: 'lb-cbb', value: plain(f.cbb), onchange: (e) => { const v = parseAmt(e.target.value, u); if (v) f.cbb = v; sum(); } }))) : null;
  const seats = h('div', { class: 'lb-seats', id: 'lb-seats' }, h('button', { type: 'button', 'aria-label': 'Fewer seats', onclick: () => { f.seats = Math.max(2, f.seats - 1); redraw(); } }, '−'), h('b', null, f.seats), h('button', { type: 'button', 'aria-label': 'More seats', onclick: () => { f.seats = Math.min(9, f.seats + 1); redraw(); } }, '+'));
  const onOff = (k, id) => seg([[true, 'On'], [false, 'Off']], f[k], set(k), id);
  return [
    g('Game', modeSeg),
    h('div', { class: 'lb-field' }, h('label', { for: 'lb-tname' }, 'Table name'), name),
    g('Blinds', blindSeg, custom),
    g('Buy-in range', h('div', { class: 'lb-slider' }, h('div', { class: 'trk' }), fill, rl, rh), h('div', { class: 'lb-amts' },
      h('div', { class: 'lb-field' }, h('label', null, 'Minimum'), inMin), h('div', { class: 'lb-field' }, h('label', null, 'Default'), inDef), h('div', { class: 'lb-field' }, h('label', null, 'Maximum'), inMax))),
    h('div', { class: 'lb-two' }, g('Seats', seats), g('Action clock', seg([[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s'], [0, 'Off']], f.timer, set('timer'), 'lb-timer'))),
    h('div', { class: 'lb-two' }, g('Blinds rise over time', seg([[true, 'On'], [false, 'Off']], f.bi, set('bi'), 'lb-bi')), g('Rebuys', onOff('rebuys', 'lb-rebuys'))),
    f.bi ? h('div', { class: 'lb-two' }, g('Every', seg([[10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min']], f.biEvery, set('biEvery'), 'lb-bievery')), g('Pace', seg([['standard', 'Standard'], ['turbo', 'Turbo']], f.biSched, set('biSched'), 'lb-bisched'))) : null,
    g('Visibility', seg([[true, 'Private', 'code or link only'], [false, 'Listed', 'shows in lobby']], f.priv, set('priv'), 'lb-priv')),
  ];
}
function submitCreate(f, err, btn) {
  const b = blindsOf(f), nm = f.name.trim();
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
  const me = info && (info.seated || []).find((p) => p.key === myKey()), n = info ? (info.seated || []).length : 0;
  const isHost = tHost(t) === myKey() || isAdmin();
  const err = h('div', { class: 'lb-err', id: 'lb-sharemsg' });
  let right;
  if (me) {
    right = h('section', { class: 'lb-card lb-stack' }, h('h2', null, 'You are seated'), h('div', { class: 'lb-muted' }, 'Stack ' + fm(me.stack, unit) + '. The hand deals automatically when a second player sits.'),
      isHost && n >= 2 ? h('button', { class: 'lb-btn blue full', id: 'lb-start', onclick: () => emit('table_start', { tableId: id }) }, 'Start when ready') : null,
      h('button', { class: 'lb-btn full', id: 'lb-enter', onclick: () => { S.onError = (m) => { err.textContent = m; }; emit('table_join', { tableId: id, buyIn: me.stack || t.buyIn.default }); } }, 'Go to the table'), err);
  } else {
    const pick = S.sharePick && S.sharePick.id === id ? S.sharePick.p : (S.sharePick = { id, p: buyInPicker(t, S.net[id]) }).p;
    const sit = h('button', { class: 'lb-btn full', id: 'lb-sit', onclick: () => { const v = pick.get(); if (v == null) return; sit.disabled = true; S.onError = (m) => { sit.disabled = false; err.textContent = m; }; emit('table_join', { tableId: id, buyIn: v, fund: pick.getFund() }); } }, 'Sit down');
    right = h('section', { class: 'lb-card lb-stack' }, h('h2', null, 'Take your seat'), pick.el, h('div', { class: 'lb-copy' }, modeNote(t.mode)), err, sit);
  }
  S.shareBox.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('button', { class: 'lb-link', onclick: () => show('lobby') }, 'Back to lobby')),
    h('div', { class: 'lb-share' },
      h('div', { class: 'lb-stack' },
        h('section', { class: 'lb-card lb-frame' }, h('div', { class: 'lb-eyebrow', style: 'text-align:center' }, t.name + '  /  share this code'), h('div', { class: 'lb-code', id: 'lb-sharecode' }, id),
          h('div', { class: 'lb-btns' }, h('button', { class: 'lb-btn blue', id: 'lb-copylink', onclick: () => copy(link, 'Link') }, 'Copy link'), h('button', { class: 'lb-btn blue', id: 'lb-copycode', onclick: () => copy(id, 'Code') }, 'Copy code'))),
        h('section', { class: 'lb-card lb-stack' }, h('h2', null, 'Who is sitting', h('small', null, n + ' of ' + t.seats)), info ? h('div', { class: 'lb-seatlist' }, seatCells(info)) : null, settingsCard(t))),
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
  const oldPin = h('input', { class: 'text-input', type: 'password', inputmode: 'numeric', maxlength: 6, placeholder: 'Current PIN', id: 'lb-oldpin' });
  const newPin = h('input', { class: 'text-input', type: 'password', inputmode: 'numeric', maxlength: 6, placeholder: 'New PIN', id: 'lb-newpin' });
  const recent = (p.recent || []).slice(0, 5);
  const nameMsg = h('div', { class: 'lb-err', id: 'lb-namemsg' }), photoMsg = h('div', { class: 'lb-err', id: 'lb-photomsg' });
  const nameIn = h('input', { class: 'text-input', id: 'lb-dispname', type: 'text', maxlength: 16, value: u.display || u.key, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') saveName(); } });
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
    h('div', { class: 'lb-prof-hd' }, h('img', { id: 'lb-profav', class: 'lb-prof-av', src: avSrc(u), alt: '' }), h('div', { class: 'lb-prof-id' }, h('h3', { id: 'lb-profname' }, u.display || u.key), h('div', { class: 'lb-muted' }, 'Signed in'))),
    h('div', { class: 'lb-field' }, h('label', { for: 'lb-dispname' }, 'Display name'),
      h('div', { class: 'lb-inline' }, nameIn, h('button', { type: 'button', class: 'lb-btn blue sm', id: 'lb-namesave', onclick: saveName }, 'Save')),
      nameMsg),
    h('div', { class: 'lb-field' }, h('label', null, 'Avatar'),
      h('div', { class: 'lb-inline lb-photo' }, h('button', { type: 'button', class: 'lb-btn blue sm', id: 'lb-photobtn', onclick: () => fileIn.click() }, 'Upload photo'), fileIn,
        h('button', { type: 'button', class: 'lb-ghost', id: 'lb-usepreset', style: u.pic ? '' : 'display:none', onclick: () => { photoMsg.textContent = ''; emit('profile_update', { avatarPic: null }); } }, 'Use preset instead')),
      photoMsg,
      h('div', { class: 'lb-avatars' }, Array.from({ length: 12 }, (_, i) => { const id = 'a' + String(i + 1).padStart(2, '0');
        return h('button', { type: 'button', class: !u.pic && id === String(av).replace(/\.png$/, '') ? 'on' : '', onclick: (e) => { av = id; photoMsg.textContent = ''; emit('profile_update', u.pic ? { avatar: id, avatarPic: null } : { avatar: id }); S.user.avatar = id; S.user.pic = null; refreshProfile(); } }, h('img', { src: avUrl(id), alt: id })); }))),
    h('div', { class: 'lb-xprow', id: 'lb-profxp' }, h('b', null, 'LV ' + (S.acctStats ? S.acctStats.level : 1)), h('span', { class: 'lb-xptrack' }, h('i', { style: 'width:' + Math.max(2, S.acctStats ? S.acctStats.xpPct : 0) + '%' })), h('small', null, S.acctStats ? S.acctStats.xp + ' / ' + S.acctStats.nextXp + ' XP' : '')),
    h('div', { class: 'lb-stats' }, h('div', null, h('b', { class: net > 0 ? 'up' : net < 0 ? 'down' : '' }, fm(net, 'cents', { signed: true })), h('small', null, 'Net')),
      h('div', null, h('b', null, st.nights ?? st.nightsPlayed ?? (p.recent || []).length), h('small', null, 'Nights')), h('div', null, h('b', null, st.hands ?? st.handsPlayed ?? 0), h('small', null, 'Hands'))),
    recent.length ? h('div', { class: 'lb-rows' }, recent.map((r) => h('div', { class: 'lb-row' }, h('div', null, h('div', { class: 't' }, r.name || r.tableName || r.nightId), h('div', { class: 's' }, r.date || '')), h('b', { class: r.net > 0 ? 'up' : 'down' }, fm(r.net, r.unit || 'cents', { signed: true }))))) : null,
    achSection(),
    h('div', { class: 'lb-field' }, h('label', null, 'Sound'), (() => { const on = () => !(window.PPSound && window.PPSound.muted); const b = h('button', { type: 'button', class: 'lb-btn blue', id: 'lb-sound', onclick: () => { const t = document.getElementById('sound-toggle'); if (t) t.click(); else if (window.PPSound) window.PPSound.setMuted(on()); b.textContent = on() ? 'Sound: on' : 'Sound: off'; } }, on() ? 'Sound: on' : 'Sound: off'); return b; })()),
    h('div', { class: 'lb-field' }, h('label', null, 'Change PIN'), h('div', { class: 'lb-two' }, oldPin, newPin)), msg,
    h('div', { class: 'acts' }, h('button', { class: 'lb-btn blue', onclick: () => { if (!/^\d{4,6}$/.test(newPin.value)) { msg.textContent = 'New PIN must be 4 to 6 digits.'; return; } S.onError = (m) => { msg.textContent = m; }; emit('pin_change', { oldPin: oldPin.value, newPin: newPin.value }); } }, 'Save PIN'), h('button', { class: 'lb-btn', onclick: closeModal }, 'Done')));
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
    h('section', { class: 'lb-card' }, h('h2', null, 'Final results'), players.map((p, i) => h('div', { class: 'lb-net', 'data-key': p.key },
      h('span', { class: 'rk' }, i + 1), h('img', { src: avSrc(p), alt: '' }),
      h('div', { class: 'nm' }, p.display || p.key, h('div', { class: 'sub' }, 'In ' + fm((p.buyIns || 0) + (p.rebuys || 0), unit) + '  /  Out ' + fm(p.cashedOut, unit))),
      h('span'), h('span', { class: 'amt ' + (p.net > 0 ? 'up' : p.net < 0 ? 'down' : '') }, fm(p.net, unit, { signed: true }))))),
    h('div', { class: 'lb-copy', style: 'margin:var(--p12) 0' }, modeNote(d.table && d.table.mode)),
    h('div', { class: 'lb-btns' },
      h('button', { class: 'lb-btn blue', id: 'lb-copytext', onclick: () => copy(d.text || '', 'Results') }, 'Copy as text'),
      h('button', { class: 'lb-btn blue', id: 'lb-clone', onclick: () => { S.onError = (m) => toast(m); emit('table_clone', { tableId: tid }); } }, 'New table, same settings'),
      h('button', { class: 'lb-btn', id: 'lb-back', onclick: () => { S.night = null; show('lobby'); } }, 'Back to lobby')))));
}

// ── host drawer ───────────────────────────────────────────────────
function hostUi(on) {
  closeDrawer();
  if (hostBtn) { hostBtn.remove(); hostBtn = null; }
  if (!on) return;
  const slot = $('host-slot'); if (!slot) return;
  hostBtn = h('button', { class: 'host-btn', id: 'host-btn', type: 'button', onclick: toggleDrawer }, 'Host'); slot.append(hostBtn);
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
  hostDrawer = h('div', { class: 'host-drawer', id: 'host-drawer' }); drawDrawer(); document.body.append(hostDrawer);
  drawerPoll = setInterval(() => { if (S.cur) emit('table_preview', { code: tId(S.cur) }); }, 2000);
  document.addEventListener('pointerdown', drawerOutside, true);
  document.addEventListener('keydown', drawerEsc, true);
}
function blindsEditor(t, id, unit) {
  window.Money && window.Money.setUnit && window.Money.setUnit(unit);
  const val = (v) => (window.Money ? window.Money.fmt(v, { symbol: false }).replace(/,/g, '') : String(v));
  const cur = t.blinds || { sb: t.sb, bb: t.bb };
  const sbIn = h('input', { class: 'text-input', id: 'host-sb', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: val(cur.sb), 'aria-label': 'Small blind' });
  const bbIn = h('input', { class: 'text-input', id: 'host-bb', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: val(cur.bb), 'aria-label': 'Big blind' });
  const note = h('div', { class: 'lb-muted', id: 'host-blinds-msg' });
  const save = () => {
    const sb = parseAmt(sbIn.value, unit), bb = parseAmt(bbIn.value, unit);
    if (sb == null || bb == null || sb < 1) { note.textContent = 'Enter both blinds.'; return; }
    if (sb >= bb) { note.textContent = 'Small blind must be less than the big blind.'; return; }
    S.onError = (m) => { note.textContent = m; };
    emit('table_update', { tableId: id, patch: { blinds: { sb, bb } } });
    note.textContent = 'Blinds set to ' + fm(sb, unit) + ' / ' + fm(bb, unit) + '. A hand in progress keeps the old blinds; the new ones start next hand.';
  };
  bbIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  sbIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return h('div', { class: 'lb-stack', style: 'gap:var(--p8)' },
    h('div', { class: 'lb-label' }, 'Blinds'),
    h('div', { class: 'lb-btns', style: 'align-items:center' }, sbIn, h('span', null, '/'), bbIn,
      h('button', { class: 'lb-btn sm', id: 'host-blinds-save', type: 'button', onclick: save }, 'Set blinds')),
    note);
}
function drawDrawer(confirmEnd) {
  if (!hostDrawer || !S.cur) return;
  const t = S.cur, id = tId(t), info = S.info[id], paused = t.state === 'paused';
  const unit = t.unit || unitOf(t.mode);
  hostDrawer.replaceChildren(
    h('h4', null, 'Host controls', h('small', null, t.name + '  /  ' + id),
      h('button', { class: 'host-x', id: 'host-close', type: 'button', 'aria-label': 'Close host controls', onclick: closeDrawer }, '\u00d7')),
    h('div', { class: 'lb-btns' },
      h('button', { class: 'lb-btn sm', id: 'host-start', onclick: () => emit('table_start', { tableId: id }) }, 'Start'),
      h('button', { class: 'lb-btn sm blue', id: 'host-pause', onclick: () => emit('table_pause', { tableId: id, paused: !paused }) }, paused ? 'Resume' : 'Pause')),
    (blindsFor === id && blindsEl) ? blindsEl : (blindsFor = id, blindsEl = blindsEditor(t, id, unit)),
    h('div', { class: 'lb-label' }, 'Players'),
    ...((info && info.seated) || []).map((p) => h('div', { class: 'lb-seat' }, h('img', { src: avSrc(p), alt: '' }), h('div', null, h('b', null, p.display || p.key), h('span', null, fm(p.stack, unit))),
      p.key !== myKey() ? h('button', { class: 'lb-ghost', onclick: () => emit('table_kick', { tableId: id, key: p.key }) }, 'Kick') : null)),
    confirmEnd ? h('div', { class: 'lb-stack', style: 'gap:var(--p10)' }, h('div', { class: 'lb-notice' }, 'End the night? The current hand finishes, then everyone cashes out.'),
      h('div', { class: 'lb-btns' }, h('button', { class: 'lb-btn sm blue', onclick: () => drawDrawer(false) }, 'Keep playing'), h('button', { class: 'lb-btn sm', id: 'host-end-confirm', onclick: () => { emit('table_end_night', { tableId: id }); toggleDrawer(); } }, 'End night'))) :
      h('button', { class: 'lb-btn sm blue full', id: 'host-end', onclick: () => drawDrawer(true) }, 'End night'));
}

// ── socket events ─────────────────────────────────────────────────
function onAuthOk({ account, token }) {
  S.resumeBusy = false; S.user = account; clearInterval(lockT);
  if (token) saveSession(account.key, token);
  const pref = account.prefs && account.prefs.currency;
  if (window.Money && window.Money.setMode && pref) window.Money.setMode(pref);
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
  s.on('money', (m) => { if (!m) return; if (S.user) S.user.bankChips = m.bank; if (m.wallet) S.wallet = m.wallet; renderTop(); });
  s.on('social:feed', onFeed);
  s.on('social:biggest', onBest);
  s.on('achv:state', (v) => { S.achv = v; drawAch(); renderAchHint(); });
  s.on('achv:unlocked', () => { if (S.achv) { S.achv.unseen = (S.achv.unseen || 0) + 1; } renderAchHint(); if ($('lb-ach')) emit('achv:state', {}); });
  s.on('lobby_tables', ({ tables }) => { S.tables = tables || []; if (S.view === 'lobby') drawLists(); });
  s.on('tables_mine', ({ tables, nightNet }) => { S.mine = tables || []; S.net = nightNet || {}; if (S.view === 'lobby') drawLists(); });
  s.on('leaderboard_data', ({ entries, me }) => { S.board = entries || []; S.boardMe = me || null; if (S.view === 'lobby') drawLists(); });
  s.on('table_created', ({ table }) => { S.cur = table; S.sharePick = null; S.onError = null; S.info[tId(table)] = S.info[tId(table)] || { table, seated: [], openSeats: table.seats }; show('share', tId(table)); });
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
  s.on('error', ({ message, code } = {}) => {
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
