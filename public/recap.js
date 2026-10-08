/* Night recap: overlay (standings, highlights, hand list, replay) plus a canvas share card. Exposes window.Recap.
   v2 port: UI kit controls (btn, panel, seg), money through Money.format in the table's unit, three injected entry points (table bar, Bank header, settle-up). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUITS = { '♠': 'S', '♣': 'C', '♥': 'H', '♦': 'D' };
  const STREET = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
  const BOARD_AT = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const st = { cur: null, settle: null, data: null, req: null, sel: 0, step: 0, timer: null, poll: null, bound: false, err: null, start: null, lastTarget: null, pending: false, quiet: false, failT: null };
  const FAIL_MS = 15000;      // (r2) critic r1 #7: a request that gets no answer at all ends the loading state too

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const user = () => { try { return window.Lobby && Lobby.user ? Lobby.user() : null; } catch { return null; } };
  const avUrl = (e) => { if (e && e.pic) return e.pic; let s = String((e && e.avatar) ?? 'a01'); if (/^\d+$/.test(s)) s = 'a' + s.padStart(2, '0'); return 'images/avatars/' + s.replace(/\.png$/, '') + '.png'; };

  // one number in the table's own unit, in the player's display mode (dollars or chips)
  function fm(v, o) {
    const unit = st.data ? st.data.scope.unit : 'chips';
    if (v == null) return '-';
    const M = window.Money;
    return M ? M.format(v, M.modeFor(M.pref, unit), o) : String(v);
  }

  // ── cards ────────────────────────────────────────────────────────
  function cardEl(c, cls) {
    if (!c) return h('span', { class: 'rc-pc back' + (cls ? ' ' + cls : ''), 'aria-label': 'Hidden card' }, '?');
    const suit = c.slice(-1), rank = c.slice(0, -1);
    return h('span', { class: 'rc-pc' + (suit === '♥' || suit === '♦' ? ' red' : '') + (cls ? ' ' + cls : ''), 'aria-label': rank + ' of ' + (SUITS[suit] || suit) }, rank, h('i', null, suit));
  }
  const emptyCard = () => h('span', { class: 'rc-pc empty' }, '.');

  // ── data ─────────────────────────────────────────────────────────
  function request(target, quiet) {
    const s = window.PingSocket; if (!s) return;
    st.lastTarget = target || st.lastTarget;
    const t = Object.assign({}, st.lastTarget || {});
    if (st.start && !t.nightId) t.start = st.start;
    // (r2) critic r1 #8: a refresh says which version it already holds; the server answers { unchanged } instead of the whole hand log
    if (quiet && st.data && st.data.version) t.have = st.data.version;
    st.pending = true; st.quiet = !!quiet;
    clearTimeout(st.failT); st.failT = setTimeout(() => settleFail('Could not load the recap. Try again.'), FAIL_MS);
    s.emit('recap_get', t);
    if (!quiet) { st.data = null; st.err = null; render(); }
  }
  function endPending() { st.pending = false; clearTimeout(st.failT); st.failT = null; }
  // (r2) critic r1 #7: any error while a request is pending ends "Loading the night" with a plain message and Try again / Close
  function settleFail(msg, force) {
    if (!st.pending) return;
    const quiet = st.quiet; endPending();
    if (!isOpen() || (quiet && st.data && !force)) return;                 // a failed background refresh keeps what is on screen
    st.err = msg; st.data = null; render();
  }
  function onData(d) {
    if (!isOpen()) return;
    if (d && d.unchanged) {                                       // nothing new: keep the screen, spend nothing
      endPending();
      if (!st.data) request(null);                                // we hold nothing for it (the scope changed meanwhile): ask for the whole thing
      return;
    }
    endPending();
    const prev = st.data && st.data.hands[st.sel];
    st.data = d; st.err = null;
    if (prev) { const i = d.hands.findIndex((x) => x.handNum === prev.handNum && x.t === prev.t); st.sel = i >= 0 ? i : d.hands.length - 1; } else st.sel = Math.max(0, d.hands.length - 1);
    if (!prev) st.step = 0;
    render();
  }
  function bindSocket() {
    const s = window.PingSocket;
    if (!s || st.bound) return !!st.bound;
    st.bound = true;
    s.on('table_joined', (d) => { if (d && d.tableId) st.cur = { tableId: d.tableId, nightId: (d.table && d.table.nightId) || null, name: d.table && d.table.name }; syncEntry(); });
    s.on('table_left', () => { st.cur = null; syncEntry(); });
    // (r2) critic r1 #6: settle_up is also the reply to night_get (Bank / night list), so it only ends the viewer's own table when that table's night is over
    s.on('settle_up', (d) => {
      if (d) st.settle = { nightId: d.nightId || null, tableId: d.tableId || (d.table && d.table.id) || null, name: d.table && d.table.name };
      const mine = d && st.cur && d.ended === true && ((st.cur.nightId && st.cur.nightId === d.nightId) || (st.cur.tableId && st.cur.tableId === d.tableId));
      if (mine) st.cur = null;
      syncEntry(); inject();
    });
    s.on('auth_out', () => { st.cur = null; st.settle = null; endPending(); close(); syncEntry(); });
    s.on('recap_data', onData);
    s.on('error', (e) => { if (isOpen()) settleFail(e && e.code === 'recap' ? (e.message || 'Recap not available') : 'Could not load the recap. Try again.', !!(e && e.code === 'recap')); });
    return true;
  }

  // ── overlay ──────────────────────────────────────────────────────
  let root = null;
  const isOpen = () => !!root && root.classList.contains('open');
  function ensureRoot() {
    if (root) return root;
    root = h('div', { class: 'rc-root', id: 'rc-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Night recap' });
    document.body.append(root);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) { e.stopPropagation(); if ($('rc-modal') && $('rc-modal').classList.contains('open')) closeCard(); else close(); } }, true);
    return root;
  }
  function open(target) {
    bindSocket();
    ensureRoot();
    st.start = null; st.sel = 0; st.step = 0; stopPlay();
    root.classList.add('open');
    request(target || (st.cur ? (st.cur.nightId ? { nightId: st.cur.nightId } : { tableId: st.cur.tableId }) : st.settle ? { nightId: st.settle.nightId } : null));
    clearInterval(st.poll);
    st.poll = setInterval(() => { if (isOpen() && st.data && !st.data.scope.ended && !document.hidden) request(null, true); }, 10000);
    setTimeout(() => { const c = $('rc-close'); if (c) c.focus(); }, 30);
  }
  function close() { if (!root) return; stopPlay(); closeCard(); clearInterval(st.poll); endPending(); root.classList.remove('open'); }

  function when(ts) { return ts ? new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function dateOnly(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }

  function render() {
    if (!root) return;
    const keepL = root.querySelector('.rc-hands-list'), top = keepL ? keepL.scrollTop : 0;
    const keepB = root.querySelector('.rc-body'), bodyTop = keepB ? keepB.scrollTop : 0;      // a step re-renders: the page must not jump back to the top
    const keepG = root.querySelector('.rc-logbox'), logTop = keepG ? keepG.scrollTop : 0;
    const d = st.data;
    const sc = d && d.scope;
    const head = h('header', { class: 'rc-head' },
      h('div', null, h('span', { class: 'rc-eyebrow' }, sc ? sc.tableName : 'The Ping'), h('h1', { class: 'rc-title' }, (sc && sc.kind === 'session' ? 'SESSION' : 'NIGHT') + ' ', h('em', null, 'RECAP'))),
      h('div', { class: 'rc-scope' }, scopeBits(sc)),
      h('div', { class: 'rc-actions' },
        h('button', { class: 'btn btn--primary btn--sm', id: 'rc-share', type: 'button', disabled: !d || !d.hands.length, onclick: showCard }, 'Share card'),
        h('button', { class: 'panel__close', id: 'rc-close', type: 'button', 'aria-label': 'Close recap', onclick: close }, '\u2715')));
    const notes = h('div', { class: 'rc-notes', id: 'rc-notes' }, d ? d.notes.map((n) => h('p', null, n)) : []);
    let body;
    if (st.err) body = h('div', { class: 'rc-body' }, h('div', { class: 'rc-card', style: 'grid-column:1/-1' }, h('div', { class: 'rc-empty', id: 'rc-error' }, h('b', null, 'No recap here'), st.err,
      h('div', { class: 'rc-modal-btns' }, h('button', { class: 'btn btn--primary btn--sm', type: 'button', id: 'rc-retry', onclick: () => request(null) }, 'Try again'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-err-close', onclick: close }, 'Close')))));
    else if (!d) body = h('div', { class: 'rc-body' }, h('div', { class: 'rc-card', style: 'grid-column:1/-1' }, h('div', { class: 'rc-empty', id: 'rc-loading' }, h('b', null, 'Loading the night'), 'Reading the hand log.')));
    else if (!d.hands.length) body = h('div', { class: 'rc-body' }, h('div', { class: 'rc-card', style: 'grid-column:1/-1' }, h('div', { class: 'rc-empty', id: 'rc-nohands' }, h('b', null, 'No hands recorded yet'), 'Play a hand and the recap fills in.')));
    else body = h('div', { class: 'rc-body' },
      h('div', { class: 'rc-col' }, standingsCard(d), highlightsCard(d)),
      h('div', { class: 'rc-col' }, replayCard(d), handsCard(d)));
    const sheet = h('div', { class: 'rc-sheet panel panel--flush' }, head, notes, body);
    const modal = h('div', { class: 'rc-modal', id: 'rc-modal' });
    root.replaceChildren(sheet, modal);
    const l = root.querySelector('.rc-hands-list'); if (l) l.scrollTop = top;
    const bd = root.querySelector('.rc-body'); if (bd) bd.scrollTop = bodyTop;
    const lg = root.querySelector('.rc-logbox'); if (lg) {
      lg.scrollTop = logTop;
      const cur = lg.querySelector('.rc-act.cur');      // keep the step being replayed inside the log window
      if (cur && lg.scrollHeight > lg.clientHeight) { if (cur.offsetTop < lg.scrollTop) lg.scrollTop = cur.offsetTop; else if (cur.offsetTop + cur.offsetHeight > lg.scrollTop + lg.clientHeight) lg.scrollTop = cur.offsetTop + cur.offsetHeight - lg.clientHeight; }
    }
  }
  function scopeBits(sc) {
    if (!sc) return [];
    const bits = [];
    if (sc.kind === 'session' && sc.sessions && sc.sessions.length) {
      const sel = h('select', { id: 'rc-session', class: 'field field--sm', 'aria-label': 'Session', onchange: (e) => { st.start = Number(e.target.value); st.data = null; request(null); } },
        sc.sessions.map((s) => h('option', { value: s.start, selected: s.start === sc.start }, when(s.start) + ', ' + s.hands + ' hands')));
      bits.push(sel);
    } else bits.push(h('span', null, sc.ended ? 'Night closed' : 'Night in progress'));
    return bits;
  }

  function standingsCard(d) {
    const rows = d.players.map((p, i) => {
      const sub = [p.hands + ' hands', p.won + ' won'];
      if (p.buyIns != null) sub.push('in ' + fm(p.buyIns));
      return h('div', { class: 'rc-row', 'data-key': p.key },
        h('span', { class: 'rk' }, i + 1), h('img', { src: avUrl(p), alt: '' }),
        h('div', { class: 'nm' }, p.name, h('small', null, sub.join('  /  '))),
        h('span', { class: 'amt ' + (p.net > 0 ? 'up' : p.net < 0 ? 'down' : '') }, fm(p.net, { signed: true })));
    });
    return h('section', { class: 'rc-card panel panel--flush', id: 'rc-standings' }, h('h3', { class: 'panel__title panel__title--sm' }, 'Up and down', h('small', null, d.scope.kind === 'session' ? 'chips won in hands' : (d.scope.ended ? 'final' : 'so far'))), h('div', { class: 'rc-scroll rc-standlist' }, rows));
  }
  function highlightsCard(d) {
    const rows = d.superlatives.map((s) => {
      const val = s.kind === 'money' ? fm(s.value) : String(s.value);
      const sub = [];
      if (s.detail && s.id !== 'besthand') sub.push(s.detail);
      return h('div', { class: 'rc-sup', 'data-id': s.id },
        h('div', null, h('div', { class: 'lb' }, s.label),
          h('div', { class: 'who' }, s.names.join(', '), ' ', sub.length ? h('small', null, sub.join(' / ')) : null, s.handNum ? h('small', null, ' ', h('button', { class: 'go', type: 'button', onclick: () => selectHandNum(s.handNum) }, 'hand ' + s.handNum)) : null),
          s.cards ? h('div', { class: 'cards' }, s.cards.map((c) => cardEl(c, 'sm')), h('span', { style: 'width:8px' }), (s.board || []).map((c) => cardEl(c, 'sm'))) : null),
        h('div', { class: 'val' + (s.kind === 'text' ? ' txt' : '') }, val));
    });
    return h('section', { class: 'rc-card panel panel--flush', id: 'rc-highlights' }, h('h3', { class: 'panel__title panel__title--sm' }, 'Highlights', h('small', null, d.totals.hands + ' hands, ' + fm(d.totals.pot) + ' in pots')),
      h('div', { class: 'rc-scroll' }, rows.length ? rows : h('div', { class: 'rc-empty' }, 'A few more hands and the highlights show up.')));
  }
  function selectHandNum(n) { const i = st.data.hands.findIndex((x) => x.handNum === n); if (i >= 0) { st.sel = i; st.step = 0; stopPlay(); render(); const r = $('rc-replay'); if (r && innerWidth < 900) r.scrollIntoView({ block: 'start' }); } }

  // ── hands list ───────────────────────────────────────────────────
  function handsCard(d) {
    const me = (user() || {}).key;
    const rows = d.hands.map((x, i) => {
      const mp = x.players.find((p) => p.key === me);
      const win = x.winners.filter((w) => (w.amount || 0) > 0);
      const names = win.map((w) => w.name).filter((v, k, a) => a.indexOf(v) === k).join(', ');
      const wh = win.find((w) => w.handName);
      return h('button', { class: 'rc-hand' + (i === st.sel ? ' sel' : ''), type: 'button', 'data-i': i, 'aria-pressed': i === st.sel ? 'true' : 'false', onclick: () => { st.sel = i; st.step = 0; stopPlay(); render(); const r = $('rc-replay'); if (r && innerWidth < 900) r.scrollIntoView({ block: 'start' }); } },
        h('span', { class: 'n' }, '#' + x.handNum),
        h('span', { class: 'mine' }, mp && mp.cards[0] ? mp.cards.map((c) => cardEl(c, 'sm')) : []),
        h('span', { class: 'res' }, names || 'No winner', ' ', h('small', null, wh ? wh.handName : (x.showdown ? '' : 'everyone folded'))),
        h('span', { class: 'pot' }, fm(x.pot)));
    });
    return h('section', { class: 'rc-card panel panel--flush', id: 'rc-hands' }, h('h3', { class: 'panel__title panel__title--sm' }, 'Hand by hand', h('small', null, 'tap a hand to replay it')), h('div', { class: 'rc-scroll rc-hands-list' }, rows));
  }

  // ── replay ───────────────────────────────────────────────────────
  function stopPlay() { clearInterval(st.timer); st.timer = null; const b = $('rc-play'); if (b) b.textContent = 'Play'; }
  function replayCard(d) {
    const x = d.hands[st.sel]; if (!x) return h('section', { class: 'rc-card panel panel--flush' });
    const n = x.actions.length, last = n + 1;
    st.step = Math.min(Math.max(st.step, 0), last);
    const s = st.step;
    const done = x.actions.slice(0, s >= last ? n : s);
    const cur = s >= 1 && s <= n ? x.actions[s - 1] : null;
    const street = s >= last ? 'river' : (cur ? cur.street : 'preflop');
    const showAll = s >= last;
    const bc = showAll ? x.board.length : Math.min(x.board.length, s === 0 ? 0 : (BOARD_AT[street] ?? 0));
    const pot = s === 0 ? 0 : s >= last ? x.pot : cur.pot;
    const folded = new Set(done.filter((a) => a.a === 'fold').map((a) => a.key));
    const winKeys = new Set(x.winners.filter((w) => (w.amount || 0) > 0).map((w) => w.key));
    const nameOf = (k) => (x.players.find((p) => p.key === k) || {}).name || k;
    const board = h('div', { class: 'rc-board', 'aria-label': 'Board' }, [0, 1, 2, 3, 4].map((i) => (i < bc && x.board[i] ? cardEl(x.board[i]) : emptyCard())));
    const seats = h('div', { class: 'rc-seats' }, x.players.map((p) => {
      const out = folded.has(p.key);
      const res = showAll ? (p.net > 0 ? 'won ' + fm(p.net) : p.net < 0 ? 'lost ' + fm(-p.net) : 'even') : folded.has(p.key) ? 'folded' : fm(p.start) + ' stack';
      return h('div', { class: 'rc-seat' + (out ? ' out' : '') + (showAll && winKeys.has(p.key) ? ' win' : ''), 'data-key': p.key },
        h('div', { class: 'hole' }, p.cards.map((c) => cardEl(c, 'sm'))),
        h('div', { class: 'who' }, (p.dealer ? h('span', { class: 'dl', title: 'Dealer' }, 'D') : null), p.name, h('small', null, res + (showAll && p.hand ? ', ' + p.hand : ''))));
    }));
    const text = (a) => {
      const w = nameOf(a.key);
      const ai = a.allIn ? ', all in' : '';
      if (a.a === 'sb') return w + ' posts the small blind ' + fm(a.put);
      if (a.a === 'bb') return w + ' posts the big blind ' + fm(a.put);
      if (a.a === 'fold') return w + ' folds';
      if (a.a === 'check') return w + ' checks';
      if (a.a === 'call') return w + ' calls ' + fm(a.put) + ai;
      if (a.a === 'back') return w + ' gets ' + fm(-a.put) + ' back, uncalled';
      return w + (a.kind === 'bet' ? ' bets ' : ' raises to ') + fm(a.to) + ai;
    };
    const log = h('div', { class: 'rc-log', id: 'rc-log' }, x.actions.map((a, i) => h('div', { class: 'rc-act' + (i < s ? ' done' : '') + (i === s - 1 ? ' cur' : '') },
      h('span', { class: 'st' }, STREET[a.street] || a.street), h('span', null, text(a)), h('span', { class: 'pt' }, fm(a.pot)))));
    const resultLine = x.winners.length ? x.winners.filter((w) => (w.amount || 0) > 0).map((w) => w.name + ' wins ' + fm(w.amount) + (w.handName ? ' with ' + w.handName : '')).join(' / ') : '';
    const ctl = h('div', { class: 'rc-ctl' },
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-prev', disabled: s <= 0, onclick: () => { stopPlay(); st.step--; render(); } }, 'Back'),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', id: 'rc-play', onclick: togglePlay }, st.timer ? 'Pause' : 'Play'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-next', disabled: s >= last, onclick: () => { stopPlay(); st.step++; render(); } }, 'Next'),
      h('span', { class: 'lab', id: 'rc-steplab' }, s === 0 ? 'Cards dealt' : s >= last ? resultLine || 'Hand over' : 'Step ' + s + ' of ' + n));
    return h('section', { class: 'rc-card panel panel--flush', id: 'rc-replay' }, h('h3', { class: 'panel__title panel__title--sm' }, 'Replay', h('small', null, 'hand ' + x.handNum + ', blinds ' + fm(x.sb) + ' / ' + fm(x.bb))),
      h('div', { class: 'rc-replay' }, h('div', { class: 'rc-rp-top' }, h('div', { class: 't' }, STREET[street] || '', h('small', null, when(x.t))), h('div', { class: 'pot', id: 'rc-pot' }, 'Pot ' + fm(pot))), board, seats, ctl, h('div', { class: 'rc-scroll rc-logbox' }, log)));
  }
  function togglePlay() {
    if (st.timer) { stopPlay(); return; }
    const x = st.data.hands[st.sel], last = x.actions.length + 1;
    if (st.step >= last) st.step = 0;
    st.timer = setInterval(() => { if (st.step >= last) { stopPlay(); return; } st.step++; render(); if (st.step >= last) stopPlay(); }, 900);
    st.step++; render();
  }

  // ── share card (canvas) ──────────────────────────────────────────
  const W = 1080, H = 1350, M = 72;
  const COL = { bg1: '#1D130C', bg2: '#120C08', brass: '#B8893A', gold: '#F5B942', ink: '#F1E6CC', dim: '#B7A486', line: '#4A3422', up: '#9CCB7B', down: '#F0907A', card: '#EBDDB9', red: '#A8352A', dark: '#1D1410' };
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  function rr(ctx, x, y, w, h2, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h2, r); ctx.arcTo(x + w, y + h2, x, y + h2, r); ctx.arcTo(x, y + h2, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function txt(ctx, s, x, y, font, color, align, maxW, spacing) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing || '0px';
    let str = String(s);
    if (maxW) { while (ctx.measureText(str).width > maxW && str.length > 1) str = str.slice(0, -1); if (str !== String(s)) str = str.replace(/\s+$/, '') + '...'; }
    ctx.fillText(str, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  function pcard(ctx, c, x, y, w, hh) {
    rr(ctx, x, y, w, hh, 6); ctx.fillStyle = COL.card; ctx.fill(); ctx.strokeStyle = '#A8956A'; ctx.lineWidth = 2; ctx.stroke();
    const suit = c.slice(-1), rank = c.slice(0, -1), red = suit === '♥' || suit === '♦';
    txt(ctx, rank + suit, x + w / 2, y + hh * 0.66, '700 ' + Math.round(w * 0.46) + 'px "Libre Baskerville", Georgia, serif', red ? COL.red : COL.dark, 'center');
  }
  async function renderCard() {
    const d = st.data; if (!d || !d.hands.length) throw new Error('No hands to share');
    try { await Promise.all(['150px "Bebas Neue"', '700 30px "Bitter"', '700 30px "Libre Baskerville"'].map((f) => document.fonts.load(f))); } catch {}
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, COL.bg1); g.addColorStop(1, COL.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COL.brass; ctx.lineWidth = 6; ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.strokeStyle = COL.line; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    const sc = d.scope, DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif', TXT = '"Bitter", Georgia, serif';
    // header: three rows on a 72px grid
    txt(ctx, (sc.tableName || 'The Ping').toUpperCase(), M, 118, '600 30px ' + TXT, COL.dim, 'left', W - 2 * M, '5px');
    txt(ctx, (sc.kind === 'session' ? 'SESSION' : 'NIGHT') + ' RECAP', M, 238, '150px ' + DISP, COL.ink, 'left', W - 2 * M, '8px');
    txt(ctx, dateOnly(sc.start || d.generatedAt) + '  /  ' + d.totals.hands + ' hands  /  ' + fm(d.totals.pot) + ' in pots', M, 290, '400 30px ' + TXT, COL.dim, 'left', W - 2 * M);
    ctx.fillStyle = COL.brass; ctx.fillRect(M, 322, W - 2 * M, 3);
    // standings
    txt(ctx, 'UP AND DOWN', M, 388, '46px ' + DISP, COL.gold, 'left', null, '5px');
    const list = d.players.slice(0, 6), rowH = Math.min(104, Math.floor(480 / list.length)), y0 = 412;
    const imgs = await Promise.all(list.map((p) => loadImg(avUrl(p))));
    list.forEach((p, i) => {
      const y = y0 + i * rowH, m = Math.round(rowH / 2);
      txt(ctx, i + 1, M + 20, y + m + 16, '48px ' + DISP, COL.dim, 'center');
      if (imgs[i]) { ctx.save(); rr(ctx, M + 60, y + m - 32, 64, 64, 8); ctx.clip(); ctx.drawImage(imgs[i], M + 60, y + m - 32, 64, 64); ctx.restore(); }
      txt(ctx, p.name, M + 148, y + m + 12, '700 36px ' + TXT, COL.ink, 'left', 480);
      txt(ctx, fm(p.net, { signed: true }), W - M, y + m + 18, '58px ' + DISP, p.net > 0 ? COL.up : p.net < 0 ? COL.down : COL.dim, 'right', null, '2px');
      ctx.fillStyle = COL.line; ctx.fillRect(M, y + rowH - 1, W - 2 * M, 1);
    });
    if (d.players.length > 6) txt(ctx, '+' + (d.players.length - 6) + ' more at the table', M + 148, y0 + list.length * rowH + 30, '400 26px ' + TXT, COL.dim, 'left');
    // highlights: rows of 84px between the standings and the footer
    const hy = y0 + list.length * rowH + (d.players.length > 6 ? 100 : 66);
    txt(ctx, 'HIGHLIGHTS', M, hy, '46px ' + DISP, COL.gold, 'left', null, '5px');
    const room = Math.max(1, Math.floor((1245 - hy - 20) / 84));
    const pick = ['bigpot', 'besthand', 'mostwins', 'bigwin', 'streak'].map((id) => d.superlatives.find((s) => s.id === id)).filter(Boolean).slice(0, room);
    pick.forEach((s, i) => {
      const y = hy + 20 + i * 84;
      const lab = s.label.toUpperCase() + (s.id === 'besthand' ? '  /  ' + String(s.value).toUpperCase() : s.id === 'bigpot' && s.detail ? '  /  ' + s.detail.toUpperCase() : '');
      txt(ctx, lab, M, y + 24, '600 22px ' + TXT, COL.dim, 'left', s.id === 'besthand' ? 480 : 520, '3px');
      txt(ctx, s.names.join(', '), M, y + 62, '700 34px ' + TXT, COL.ink, 'left', s.id === 'besthand' ? 480 : 520);
      if (s.id === 'besthand') {
        const cs = (s.cards || []).concat(s.board || []);
        cs.forEach((c, k) => pcard(ctx, c, W - M - 7 * 58 - 14 + k * 58 + (k >= 2 ? 14 : 0), y + 4, 52, 72));
      } else {
        const v = s.kind === 'money' ? fm(s.value) : String(s.value);
        txt(ctx, v, W - M, y + 62, '64px ' + DISP, COL.gold, 'right', 400, '2px');
      }
    });
    txt(ctx, 'THE PING', W / 2, H - 70, '44px ' + DISP, COL.brass, 'center', null, '12px');
    return cv;
  }
  const canvasBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
  async function cardDataUrl() { const cv = await renderCard(); return cv.toDataURL('image/png'); }

  async function showCard() {
    const m = $('rc-modal'); if (!m) return;
    m.classList.add('open');
    m.replaceChildren(h('div', { class: 'rc-empty' }, 'Drawing the card...'));
    try {
      const cv = await renderCard(), blob = await canvasBlob(cv), url = URL.createObjectURL(blob);
      const file = new File([blob], 'ping-recap.png', { type: 'image/png' });
      const msg = h('div', { class: 'rc-modal-msg', id: 'rc-card-msg' }, ' ');
      const btns = h('div', { class: 'rc-modal-btns' },
        h('a', { class: 'btn btn--primary btn--sm', id: 'rc-dl', href: url, download: 'ping-recap.png' }, 'Download PNG'),
        navigator.canShare && navigator.canShare({ files: [file] }) ? h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-sharefile', onclick: () => navigator.share({ files: [file], title: 'Night recap' }).catch(() => {}) }, 'Share') : null,
        navigator.clipboard && window.ClipboardItem ? h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-copyimg', onclick: async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); msg.textContent = 'Image copied.'; } catch { msg.textContent = 'Copy not allowed here. Use Download.'; } } }, 'Copy image') : null,
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'rc-card-close', onclick: closeCard }, 'Close'));
      m.replaceChildren(h('div', { class: 'rc-modal-in' }, h('img', { id: 'rc-card-img', src: url, alt: 'Recap card preview' }), h('div', null, btns, msg)));
    } catch (e) { m.replaceChildren(h('div', { class: 'rc-empty' }, h('b', null, 'Could not draw the card'), String(e.message || e)), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: closeCard }, 'Close')); }
  }
  function closeCard() { const m = $('rc-modal'); if (m) { m.classList.remove('open'); m.replaceChildren(); } }

  // ── entry points ─────────────────────────────────────────────────
  // Three buttons, injected (lobby.js, game.js and bank.js are not edited): the table bar next to BANK, the Bank panel header, the night-end screen.
  const recapBtn = (id, cls, label, onclick) => h('button', { type: 'button', id, class: cls, title: 'Night recap', onclick }, label);
  function syncEntry() { for (const id of ['rc-table-btn', 'rc-bank-btn']) { const b = $(id); if (b) b.classList.toggle('hidden', !st.cur); } }
  function inject() {
    const bank = $('bank-btn');
    if (bank && !$('rc-table-btn')) bank.after(recapBtn('rc-table-btn', 'btn btn--secondary btn--sm' + (st.cur ? '' : ' hidden'), 'Recap', () => open()));
    const head = document.querySelector('#bank-panel .bank-head');
    if (head && !$('rc-bank-btn')) {
      const b = recapBtn('rc-bank-btn', 'btn btn--secondary btn--sm' + (st.cur ? '' : ' hidden'), 'Recap', () => open());
      const anchor = $('bank-view');
      if (anchor) anchor.after(b); else head.append(b);
    }
    const bt = document.querySelector('.lb-settle .lb-btns');
    if (bt && !$('lb-recap') && st.settle && st.settle.nightId) bt.prepend(recapBtn('lb-recap', 'btn btn--secondary', 'Night recap', () => open({ nightId: st.settle.nightId })));
  }
  function boot() {
    const tryBind = () => { if (bindSocket()) clearInterval(iv); };
    const iv = setInterval(tryBind, 300); tryBind();
    let q = false;
    new MutationObserver(() => { if (q) return; q = true; requestAnimationFrame(() => { q = false; inject(); }); }).observe(document.body, { childList: true, subtree: true });
    inject();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.Recap = { open, close, renderCard, cardDataUrl, state: st };
})();
