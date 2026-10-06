/* The Ping shell: persistent top bar, game dock, window manager, game registry.
   Owns the one socket (window.PingSocket) for slot windows; games plug in via Shell.registerGame. */
(function () {
  'use strict';
  const KEY = 'ping.layout';
  const MIN_W = 360, MIN_H = 540;
  const games = new Map();   // id -> {def, el, di, mounted}
  const screens = new Map(); // id -> {mountFn, el, mounted}
  const ui = {};
  const cfg = { benderUrl: '/games/bender/index.html?bridge=1' };
  let L = { games: {} };
  let signedIn = false, focusId = 'poker', zTop = 20, inResize = false;
  const wallet = { play: null, chips: null };
  let chipsTotal = null;
  let wmode = 'play', lastWin = 0, sessNet = 0;
  const $ = (id) => document.getElementById(id);
  const sock = () => window.PingSocket || null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.games) L = j; } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { /* ignore */ } };
  const gs = (id) => (L.games[id] || (L.games[id] = { open: false, mode: 'dock', side: 'right', w: 0.4, rect: null, restore: 'dock' }));

  const dollars = (c) => { const n = Math.round(c), a = Math.abs(n), whole = Math.floor(a / 100).toLocaleString('en-US'); return (n < 0 ? '-' : '') + '$' + whole + (a % 100 ? '.' + String(a % 100).padStart(2, '0') : ''); };
  const chipAmt = (n) => { const M = window.Money; return M ? M.format(n, M.modeFor(M.pref, 'chips')) : Number(n).toLocaleString('en-US'); };
  const dollars2 = (c) => { const n = Math.round(c), a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };

  const IC = {
    spade: '<svg viewBox="0 0 24 24"><path d="M12 2C9 7 4 9.6 4 13.6a4 4 0 0 0 6.4 3.2c-.2 1.6-.9 3-2.4 4.2h8c-1.5-1.2-2.200-2.600-2.400-4.200A4 4 0 0 0 20 13.600C20 9.600 15 7 12 2z"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 9h18v11H3zM6 9V6h12v3zM8 13h8v2H8z" fill-rule="evenodd"/><path d="M9 3h6l1 3H8z"/></svg>',
    soon: '<svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3h2v11H5V10zm2 0h6V7a3 3 0 0 0-6 0z" fill-rule="evenodd"/></svg>'
  };
  const WB = {
    dl: '<svg viewBox="0 0 14 14"><rect x="1.500" y="1.500" width="11" height="11"/><path d="M5.500 1.500v11"/></svg>',
    dr: '<svg viewBox="0 0 14 14"><rect x="1.500" y="1.500" width="11" height="11"/><path d="M8.500 1.500v11"/></svg>',
    fl: '<svg viewBox="0 0 14 14"><rect x="1.500" y="3.500" width="8" height="8"/><path d="M4.500 3.500v-2h8v8h-3"/></svg>',
    mn: '<svg viewBox="0 0 14 14"><path d="M2 11h10"/></svg>',
    mx: '<svg viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10"/></svg>',
    cl: '<svg viewBox="0 0 14 14"><path d="M2.500 2.500l9 9M11.500 2.500l-9 9"/></svg>'
  };

  // ---------- DOM ----------
  function build() {
    const root = $('shell-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'shell-root' }));
    root.className = 'sh-app';
    root.innerHTML = `
      <header class="sh-top">
        <img class="sh-logo" src="/images/ui/vp-mark.png" alt=""><span class="sh-brand">THE PING</span>
        <span class="sh-lvl" id="sh-lvl"><span id="sh-flame"></span><span id="sh-xp"></span></span>
        <div class="sh-wallet" id="sh-wallet" title="Play $ is pretend money. Chips are your poker bank."><span id="sh-chips" title="Chips: your poker bank plus what you have at the table"><small>Chips</small>--</span><span id="sh-play"><small>Play</small>--</span></div>
        <span data-money-toggle></span>
        <button class="sh-bonus" id="sh-bonus" type="button" title="Daily bonus"></button>
        <button class="sh-acct" id="sh-acct" type="button"></button>
        <button class="sh-btn" id="sh-out" type="button">Sign out</button>
      </header>
      <nav class="sh-dock" id="sh-dock"></nav>
      <main class="sh-main" id="sh-main"><div class="sh-stage" id="sh-stage"></div><div class="sh-split" id="sh-split"></div></main>`;
    ui.root = root; ui.main = $('sh-main'); ui.stage = $('sh-stage'); ui.dock = $('sh-dock'); ui.split = $('sh-split');
    for (const id of ['lobby-root', 'game-screen']) { const n = $(id); if (n) ui.stage.appendChild(n); }
    $('sh-out').addEventListener('click', () => { if (window.Lobby && typeof window.Lobby.signOut === 'function') window.Lobby.signOut(); else if (sock()) sock().emit('auth_logout', {}); });
    $('sh-lvl').addEventListener('click', () => { if (window.Lobby && window.Lobby.show) window.Lobby.show('profile'); });
    $('sh-bonus').addEventListener('click', () => {
      const s = sock(); if (!s) return;
      reopenBonus = true; s.emit('bonus:status');
    });
    $('sh-acct').addEventListener('click', () => { if (window.Lobby && window.Lobby.show) window.Lobby.show('profile'); });
    ui.stage.addEventListener('pointerdown', () => focus('poker', { soft: true }), true);
    ui.split.addEventListener('pointerdown', splitDrag);
  }

  // ---------- registry ----------
  function registerGame(def) {
    if (!def || !def.id || games.has(def.id)) return;
    const g = { def, el: null, di: null, mounted: false };
    games.set(def.id, g);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sh-di'; b.dataset.game = def.id;
    b.innerHTML = `${def.icon || IC.box}<span class="tip">${def.name}</span><span class="badge"></span>`;
    b.addEventListener('click', () => dockClick(def.id));
    g.di = b;
    const soon = ui.dock.querySelector('.sh-sep');
    ui.dock.insertBefore(b, soon || null);
    if (signedIn && def.kind !== 'stage' && gs(def.id).open) openGame(def.id, { quiet: true });
    refreshDock();
  }
  function registerScreen(id, mountFn) { screens.set(id, { mountFn, el: null, mounted: false }); }
  function showScreen(id) {
    const s = screens.get(id); if (!s) return;
    if (!s.el) { s.el = document.createElement('div'); s.el.className = 'sh-screen'; s.el.style.cssText = 'position:absolute;inset:0;overflow:auto'; ui.stage.appendChild(s.el); }
    if (!s.mounted) { s.mounted = true; s.mountFn(s.el, ctx()); }
    for (const o of screens.values()) if (o.el) o.el.style.display = o === s ? '' : 'none';
  }
  const ctx = () => ({ shell: Shell, socket: sock(), wallet: Object.assign({}, wallet), emit: (ev, p) => sock() && sock().emit(ev, p) });

  function dockClick(id) {
    const g = games.get(id); if (!g) return;
    if (g.def.kind === 'stage') {
      if (window.PingGame && window.PingGame.isIn && window.PingGame.isIn()) focus(id);
      else if (window.Lobby && window.Lobby.show) window.Lobby.show('lobby');
      return;
    }
    const s = gs(id);
    if (!s.open) openGame(id);
    else if (s.mode === 'min') { restore(id); focus(id); }
    else if (focusId === id) minimize(id);
    else focus(id);
  }

  // ---------- windows ----------
  function makeWindow(id) {
    const g = games.get(id), s = gs(id);
    const el = document.createElement('section');
    el.className = 'sh-win'; el.dataset.game = id;
    el.innerHTML = `<div class="sh-title"><b>${g.def.name}</b><div class="sh-wb">
        <button data-a="dl" title="Dock left" type="button">${WB.dl}</button><button data-a="dr" title="Dock right" type="button">${WB.dr}</button>
        <button data-a="fl" title="Float" type="button">${WB.fl}</button><button data-a="mn" title="Minimize to dock" type="button">${WB.mn}</button>
        <button data-a="mx" title="Maximize" type="button">${WB.mx}</button><button data-a="cl" title="Close" type="button">${WB.cl}</button></div></div>
      <div class="sh-body"></div>
      ${['se', 'sw', 'e', 'w', 's'].map((d) => `<i class="sh-h ${d}" data-h="${d}"></i>`).join('')}`;
    ui.main.appendChild(el);
    g.el = el;
    el.addEventListener('pointerdown', () => { if (focusId !== id) focus(id, { soft: true }); }, true);
    el.querySelector('.sh-wb').addEventListener('click', (e) => {
      const a = e.target.closest('button'); if (!a) return;
      ({ dl: () => dock(id, 'left'), dr: () => dock(id, 'right'), fl: () => float(id), mn: () => minimize(id), mx: () => maximize(id), cl: () => close(id) })[a.dataset.a]();
    });
    const t = el.querySelector('.sh-title');
    t.addEventListener('pointerdown', (e) => titleDrag(e, id));
    t.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) maximize(id); });
    el.querySelectorAll('.sh-h').forEach((h) => h.addEventListener('pointerdown', (e) => resizeDrag(e, id, h.dataset.h)));
    if (!g.mounted) { g.mounted = true; g.def.mount && g.def.mount(el.querySelector('.sh-body'), ctx()); }
    return el;
  }

  function openGame(id, opts = {}) {
    const g = games.get(id); if (!g) return;
    if (g.def.kind === 'stage') { focus(id); return; }
    const s = gs(id);
    if (!g.el) makeWindow(id);
    s.open = true;
    if (opts.mode) s.mode = opts.mode; else if (s.mode === 'min') s.mode = s.restore || 'dock';
    if (opts.side) s.side = opts.side;
    save(); layout();
    if (!opts.quiet) focus(id);
  }
  function restore(id) { const s = gs(id); if (s.mode === 'min' || s.mode === 'max') { s.mode = s.restore && s.restore !== 'min' && s.restore !== 'max' ? s.restore : 'dock'; save(); layout(); } }
  function minimize(id) { const s = gs(id); if (!s.open) return; if (s.mode !== 'min') { if (s.mode !== 'max') s.restore = s.mode; s.mode = 'min'; } if (focusId === id) focus('poker'); save(); layout(); }
  function maximize(id) { const s = gs(id); if (s.mode === 'max') { restore(id); return; } if (s.mode !== 'min') s.restore = s.mode; s.mode = 'max'; save(); layout(); focus(id); }
  function float(id) { const s = gs(id); s.mode = 'float'; if (!s.rect) s.rect = defaultRect(); save(); layout(); focus(id); }
  function dock(id, side) {
    const s = gs(id);
    for (const [oid, g] of games) { const o = gs(oid); if (oid !== id && g.def.kind !== 'stage' && o.open && o.mode === 'dock' && o.side === side) { o.mode = 'float'; if (!o.rect) o.rect = defaultRect(); } }
    s.mode = 'dock'; s.side = side; s.open = true; save(); layout(); focus(id);
  }
  function close(id) {
    const g = games.get(id), s = gs(id); if (!g || !g.el) return;
    s.open = false; if (focusId === id) focus('poker');
    g.el.remove(); g.el = null; g.mounted = false; g.def.onClose && g.def.onClose();
    save(); layout();
  }
  const mainRect = () => ({ w: ui.main.clientWidth, h: ui.main.clientHeight });
  function defaultRect() { const m = mainRect(); const w = Math.min(440, m.w - 40), h = Math.min(720, m.h - 40); return { x: Math.max(0, m.w - w - 24), y: 24, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) }; }
  function clampRect(r, m) {
    const w = clamp(r.w, Math.min(MIN_W, m.w), m.w), h = clamp(r.h, Math.min(MIN_H, m.h), m.h);
    return { x: clamp(r.x, 0, m.w - w), y: clamp(r.y, 0, m.h - h), w, h };
  }

  function layout() {
    if (!ui.main) return;
    const m = mainRect();
    let stl = 0, str = 0, splitX = null;
    for (const [id, g] of games) {
      if (g.def.kind === 'stage') continue;
      const s = gs(id), el = g.el;
      if (!el) continue;
      const on = s.open && signedIn;
      el.classList.toggle('open', on);
      el.classList.toggle('min', s.mode === 'min');
      el.classList.toggle('docked', s.mode === 'dock');
      el.classList.toggle('floating', s.mode === 'float');
      el.classList.toggle('max', s.mode === 'max');
      el.classList.toggle('side-left', s.side === 'left');
      if (!on || s.mode === 'min') continue;
      let r;
      if (s.mode === 'dock') {
        const bw = clamp(Math.round(m.w * s.w), Math.min(MIN_W, m.w), Math.max(MIN_W, m.w - 420));
        r = { x: s.side === 'left' ? 0 : m.w - bw, y: 0, w: bw, h: m.h };
        if (s.side === 'left') { stl = bw; splitX = bw; } else { str = bw; splitX = m.w - bw; }
      } else if (s.mode === 'max') r = { x: 0, y: 0, w: m.w, h: m.h };
      else { s.rect = clampRect(s.rect || defaultRect(), m); r = s.rect; }
      Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      if (!el.style.zIndex) el.style.zIndex = ++zTop;
    }
    ui.stage.style.setProperty('--stg-l', stl + 'px'); ui.stage.style.setProperty('--stg-r', str + 'px');
    ui.split.classList.toggle('show', splitX !== null);
    if (splitX !== null) ui.split.style.left = splitX + 'px';
    const sw = m.w - stl - str;
    const u = clamp(Math.min(m.h / 900, sw / 1440), 0.45, 1.35);
    ui.stage.style.setProperty('--u', u.toFixed(4));
    ui.stage.style.setProperty('--stage-w', sw + 'px');
    refreshDock();
    inResize = true; window.dispatchEvent(new Event('resize')); inResize = false;
  }

  // ---------- drag / resize ----------
  function dragging(on) { ui.root.classList.toggle('dragging', on); }
  function titleDrag(e, id) {
    if (e.target.closest('button') || e.button !== 0) return;
    const s = gs(id); if (s.mode === 'max') return;
    const t = e.currentTarget; t.setPointerCapture(e.pointerId);
    let bx = e.clientX, by = e.clientY, origin = s.mode === 'float' ? Object.assign({}, s.rect) : null, moved = false;
    dragging(true);
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - bx, ev.clientY - by) < 6) return;
      moved = true;
      if (!origin) {
        const mr = ui.main.getBoundingClientRect(), d = defaultRect();
        s.mode = 'float'; origin = { x: ev.clientX - mr.left - d.w / 2, y: 0, w: d.w, h: d.h }; s.rect = origin; bx = ev.clientX; by = ev.clientY;
        return layout();
      }
      s.rect = clampRect({ x: origin.x + ev.clientX - bx, y: origin.y + ev.clientY - by, w: origin.w, h: origin.h }, mainRect());
      layout();
    };
    const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); dragging(false); save(); };
    t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
  }
  function resizeDrag(e, id, dir) {
    const s = gs(id); if (s.mode !== 'float') return;
    const h = e.currentTarget; h.setPointerCapture(e.pointerId); e.preventDefault();
    const o = Object.assign({}, s.rect), sx = e.clientX, sy = e.clientY, m = mainRect();
    dragging(true);
    const mv = (ev) => {
      let { x, y, w, h: hh } = o; const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (dir.includes('e')) w = clamp(o.w + dx, MIN_W, m.w - o.x);
      if (dir.includes('w')) { const nw = clamp(o.w - dx, MIN_W, o.x + o.w); x = o.x + o.w - nw; w = nw; }
      if (dir.includes('s')) hh = clamp(o.h + dy, MIN_H, m.h - o.y);
      s.rect = { x, y, w, h: hh }; layout();
    };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); dragging(false); save(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }
  function splitDrag(e) {
    const dockedId = [...games.keys()].find((id) => { const s = gs(id); return s.open && s.mode === 'dock'; });
    if (!dockedId) return;
    const s = gs(dockedId), el = ui.split; el.setPointerCapture(e.pointerId); dragging(true);
    const mv = (ev) => {
      const mr = ui.main.getBoundingClientRect(), x = ev.clientX - mr.left;
      s.w = clamp((s.side === 'left' ? x : mr.width - x) / mr.width, MIN_W / mr.width, 1 - 420 / mr.width); layout();
    };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); dragging(false); save(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  // ---------- focus ----------
  function focus(id, opts = {}) {
    const g = games.get(id); if (!g) return;
    const prev = focusId;
    focusId = id;
    for (const [oid, o] of games) { if (o.el) o.el.classList.toggle('focused', oid === id); }
    if (g.el) g.el.style.zIndex = ++zTop;
    if (prev !== id) { const p = games.get(prev); p && p.def.onBlur && p.def.onBlur(); g.def.onFocus && g.def.onFocus(); }
    if (!opts.soft) {
      if (g.def.kind === 'stage') { const a = document.activeElement; if (a && a.tagName === 'IFRAME') a.blur(); window.focus(); }
      else { const f = g.el && g.el.querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.focus(); }
    }
    refreshDock();
  }
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === 'IFRAME') for (const [id, g] of games) if (g.el && g.el.contains(a) && focusId !== id) focus(id, { soft: true });
    }, 0);
  });
  window.addEventListener('focus', () => { const a = document.activeElement; if (!(a && a.tagName === 'IFRAME') && focusId !== 'poker') focus('poker', { soft: true }); });
  window.addEventListener('resize', () => { if (!inResize) layout(); });

  // ---------- top bar / dock refresh ----------
  const user = () => { try { return window.Lobby && window.Lobby.user ? window.Lobby.user() : null; } catch (e) { return null; } };
  if (window.Money && window.Money.onPrefChange) window.Money.onPrefChange(() => { try { refreshTop(); } catch (e) {} });
  function refreshTop() {
    const p = $('sh-play'); if (!p) return;
    const c = $('sh-chips'); if (c) c.innerHTML = '<small>Chips</small>' + (chipsTotal == null ? '--' : chipAmt(chipsTotal));
    p.innerHTML = '<small>Play</small>' + (wallet.play == null ? '--' : dollars(wallet.play));
    const u = user(); $('sh-acct').textContent = u ? (u.display || u.key || '') : '';
  }
  function needsAction() {
    try {
      if (window.PingGame && typeof window.PingGame.needsAction === 'function') return !!window.PingGame.needsAction();
      const cc = $('btn-check-call'), gsn = $('game-screen');
      return !!(gsn && gsn.classList.contains('active') && cc && !cc.disabled);
    } catch (e) { return false; }
  }
  function refreshDock() {
    for (const [id, g] of games) {
      const s = gs(id), b = g.di; if (!b) continue;
      const open = g.def.kind === 'stage' ? !!(window.PingGame && window.PingGame.isIn && window.PingGame.isIn()) : s.open;
      b.classList.toggle('on', open && s.mode !== 'min' && focusId === id);
      let txt = '';
      if (g.def.badge && open && s.mode === 'min') { try { txt = g.def.badge() || ''; } catch (e) { txt = ''; } }
      b.classList.toggle('has-badge', !!txt); const bd = b.querySelector('.badge'); bd.textContent = txt; bd.classList.toggle('neg', txt.charAt(0) === '-'); bd.title = txt ? 'Session net this sitting' : '';
      if (g.def.kind === 'stage') b.classList.toggle('pulse', open && focusId !== id && needsAction());
    }
  }

  function setSignedIn(v) {
    v = !!v; if (v === signedIn) return;
    signedIn = v; document.body.classList.toggle('sh-on', v);
    if (v) { for (const [id, g] of games) if (g.def.kind !== 'stage' && gs(id).open && !g.el) makeWindow(id); }
    else for (const [, g] of games) if (g.el) { g.el.remove(); g.el = null; g.mounted = false; }
    refreshTop(); layout();
  }

  // ---------- socket ----------
  const bound = new WeakSet();
  let benderReady = false; const spinQ = []; const stateTimers = [];
  function bindSocket() {
    const s = sock(); if (!s || bound.has(s)) return !!s;
    bound.add(s);
    s.on('wallet', (w) => { setWallet(w); });
    s.on('money', (m) => { if (!m) return; chipsTotal = typeof m.chips === 'number' ? m.chips : null; if (m.wallet) setWallet(m.wallet); else refreshTop(); });
    s.on('auth_ok', () => { setSignedIn(true); refreshTop(); s.emit('wallet_get'); bonusShown = false; s.emit('bonus:status'); });
    s.on('auth_out', () => { chipsTotal = null; setSignedIn(false); bonusShown = false; if (window.PingJuice) { PingJuice.streakFlame($('sh-flame'), 0); } const x = $('sh-xp'); if (x) x.textContent = ''; lastXp = null; lastStats = null; bonusSt = null; renderBonusBtn(); });
    s.on('social:event', onSocialEvent);
    s.on('account:stats', onStats);
    s.on('achv:unlocked', onAchv);
    s.on('bonus:status', (b) => {
      if (!b) return;
      bonusSt = b; renderBonusBtn();
      if (!window.PingJuice || (!reopenBonus && (!b.available || bonusShown))) { reopenBonus = false; return; }
      bonusShown = true; reopenBonus = false;
      PingJuice.streakCalendar(b, { targetEl: $('sh-wallet'), format: dollars, onClaim: () => s.emit('bonus:claim') });
    });
    s.on('bonus:claimed', (r) => { if (r && r.ok && r.wallet) setWallet(r.wallet); if (r && r.ok && window.PingJuice) PingJuice.toast('Day **' + (r.day || r.streak) + '** bonus **' + dollars(r.amountCents) + '** claimed. Streak **' + r.streak + '**', { sticker: 'vp-chip' }); });
    s.on('g:bender:state', (st) => { benderReady = true; if (st && st.balances) setWallet(st.balances); toBender({ type: 'init', wallet: Object.assign({}, wallet), mode: wmode, bets: (st && (st.bets || st.betLevels)) || undefined, cfg: st && st.cfg }); });
    s.on('g:bender:cfg', (c) => { if (c && c.cfg) toBender({ type: 'cfg', cfg: c.cfg }); });
    s.on('g:bender:result', (p) => {
      const reqId = spinQ.shift(); lastWin = p && typeof p.totalWin === 'number' ? p.totalWin : lastWin;
      if (p && typeof p.totalWin === 'number' && typeof p.cost === 'number') sessNet += p.totalWin - p.cost;
      if (p && p.balances) setWallet(p.balances);
      toBender({ type: 'result', reqId, payload: p }); refreshDock();
    });
    s.on('g:bender:error', (e) => benderErr(e));
    s.on('error', (e) => { if (spinQ.length) benderErr(e); });
    if (user()) { setSignedIn(true); s.emit('wallet_get'); s.emit('account:stats'); bonusShown = false; s.emit('bonus:status'); }
    return true;
  }
  let bonusShown = false, bonusSt = null, reopenBonus = false;
  function untilReset() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
    const g = (t) => +f.find((x) => x.type === t).value % 24;
    const left = 86400 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
    return Math.floor(left / 3600) + 'h ' + String(Math.floor((left % 3600) / 60)).padStart(2, '0') + 'm';
  }
  function renderBonusBtn() {
    const b = $('sh-bonus'); if (!b) return;
    const av = !!(bonusSt && bonusSt.available);
    b.classList.toggle('ready', av);
    const dn = bonusSt ? (bonusSt.day || bonusSt.streak || 1) : 1;
    b.title = 'Daily streak calendar';
    b.innerHTML = bonusSt ? (av ? 'Day ' + dn + ' <em>' + dollars(bonusSt.amountCents) + '</em>' : 'Day ' + dn + ' <em>' + untilReset() + '</em>') : '';
    b.hidden = !bonusSt;
  }
  setInterval(renderBonusBtn, 30000);
  function onSocialEvent(e) {
    if (!e || e.kind !== 'bigwin' || !window.PingJuice) return;
    const nm = String(e.name || 'Someone').replace(/\*/g, '');
    const amt = typeof e.amountCents === 'number' ? (e.unit === 'chips' ? chipAmt(e.amountCents) : dollars(e.amountCents)) : '';
    if (e.game === 'bender') PingJuice.toast(`**${nm}** hit **${amt}** on Ballot Bender`, { sticker: 'vp-chip' });
    else PingJuice.toast(`**${nm}** took a **${amt}** pot`, { sticker: 'ping-hand' });
  }
  const ACH_STICKER = { bronze: 'vp-chip', silver: 'vp-horseshoe', gold: 'boba-crown' };
  function onAchv(a) {
    if (!a || !window.PingJuice) return;
    const tier = String(a.tier || 'bronze'), nm = String(a.name || '').replace(/\*/g, '');
    PingJuice.toast(`Achievement: **${nm}** (${tier[0].toUpperCase() + tier.slice(1)}) **+${dollars(a.rewardCents || 0)}**`, { sticker: ACH_STICKER[tier] || 'vp-chip', ms: 3800 });
    try { PingJuice.sfx(tier === 'gold' ? 'big' : 'claim'); } catch (e) { /* sound is optional */ }
    if (tier === 'gold') { try { PingJuice.stickerPop('boba-crown', $('sh-lvl') || null, { dy: 40, hold: 1800 }); } catch (e) { /* optional */ } }
  }
  let lastXp = null, lastStats = null;
  function xpFloaty(n) {
    const c = $('sh-lvl'); if (!c) return;
    const r = c.getBoundingClientRect(), el = document.createElement('div');
    el.className = 'sh-xpfloat'; el.textContent = '+' + n + ' XP';
    el.style.cssText = 'left:' + (r.left + 8) + 'px;top:' + (r.bottom + 2) + 'px';
    document.body.appendChild(el);
    const done = () => el.remove();
    el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(4px)', offset: 0.2 }, { opacity: 1, transform: 'translateY(14px)', offset: 0.7 }, { opacity: 0, transform: 'translateY(26px)' }], { duration: 1600, fill: 'forwards' }).onfinish = done;
    setTimeout(done, 2100);
  }
  function onStats(st) {
    if (!st || !window.PingJuice) return;
    PingJuice.xpBar($('sh-xp'), st.xpPct, st.level);
    const chip = $('sh-lvl'); if (chip) chip.title = 'Level ' + st.level + ': ' + st.xp + ' of ' + st.nextXp + ' XP. Click for profile.';
    if (lastXp != null && st.xp > lastXp) xpFloaty(st.xp - lastXp);
    lastXp = st.xp; lastStats = st;
    PingJuice.streakFlame($('sh-flame'), st.winStreak >= 2 ? st.winStreak : 0);
  }
  function benderErr(e) { const reqId = spinQ.shift(); toBender({ type: 'error', reqId, message: (e && e.message) || 'Spin refused.' }); }
  function setWallet(w) {
    if (!w) return;
    if (typeof w.play === 'number') wallet.play = w.play;
    if (typeof w.chips === 'number') wallet.chips = w.chips;
    refreshTop(); if (benderReady) toBender({ type: 'wallet', wallet: Object.assign({}, wallet) });
  }
  const benderFrame = () => { const g = games.get('bender'); return g && g.el ? g.el.querySelector('iframe') : null; };
  function toBender(m) { const f = benderFrame(); if (f && f.contentWindow) f.contentWindow.postMessage(m, '*'); }
  window.addEventListener('message', (ev) => {
    const f = benderFrame(); if (!f || ev.source !== f.contentWindow) return;
    const m = ev.data || {};
    if (m.type === 'hello') {
      const s = sock(); if (!s || !signedIn) return;
      benderReady = false; s.emit('g:bender:state', {});
    } else if (m.type === 'spin') {
      const s = sock(); if (!s) return toBender({ type: 'error', reqId: m.reqId, message: 'Not connected.' });
      spinQ.push(m.reqId);
      const p = { bet: m.bet, mode: m.mode }; if (m.buy) p.buyBonus = m.buy;
      s.emit('g:bender:spin', p);
    } else if (m.type === 'mode') { wmode = m.mode === 'chips' ? 'chips' : 'play'; }
    else if (m.type === 'round') {
      if (typeof m.win === 'number') lastWin = m.win; refreshDock();
      if (window.PingJuice && (m.tier === 'mega' || m.tier === 'jackpot') && m.bet > 0) PingJuice.toast(`**You** hit **${Math.round(m.win / m.bet)}x** on Ballot Bender`, { sticker: 'ballot-cherry' });
    }
    else if (m.type === 'esc') focus('poker');
  });

  // ---------- built-in games ----------
  function registerBuiltins() {
    registerGame({ id: 'poker', name: 'Poker', kind: 'stage', icon: IC.spade });
    registerGame({
      id: 'bender', name: 'Ballot Bender', icon: IC.box,
      mount(el) { const f = document.createElement('iframe'); f.src = cfg.benderUrl; f.title = 'Ballot Bender'; f.setAttribute('allow', 'autoplay'); el.appendChild(f); benderReady = false; },
      badge() { return sessNet > 0 ? '+' + dollars2(sessNet) : sessNet < 0 ? '-' + dollars2(-sessNet) : ''; }
    });
    ui.dock.appendChild(Object.assign(document.createElement('i'), { className: 'sh-sep' }));
    for (const n of ['Blackjack', 'Roulette']) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sh-di soon'; b.disabled = true;
      b.innerHTML = `${IC.soon}<span class="tip">${n}: coming soon</span>`; ui.dock.appendChild(b);
    }
  }

  const Shell = { registerGame, registerScreen, showScreen, openGame, focus, minimize, maximize, restore, close, float, dock, layout, config: cfg, setSignedIn, setWallet, isSignedIn: () => signedIn, state: () => L };
  window.Shell = Shell;

  function init() {
    if (ui.root) return;
    build(); registerBuiltins(); layout();
    let tries = 0; const iv = setInterval(() => { if (bindSocket() || ++tries > 100) clearInterval(iv); }, 200);
    setInterval(() => { const u = user(); if (window.Lobby && window.Lobby.user) { if (!!u !== signedIn) setSignedIn(!!u); refreshTop(); } refreshDock(); }, 500);
  }
  if (document.readyState === 'loading' && !$('shell-root')) document.addEventListener('DOMContentLoaded', init); else init();
})();
