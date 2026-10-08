/* Campaign Trail: the client. Talks to the server only through the shell's postMessage bridge (shell.js, "Campaign bridge").
   No rules, odds, multipliers or outcomes live here: every number on screen is a server field (runView, end, balances). */
(function () {
  'use strict';
  const C = window.CampaignCopy, $ = (id) => document.getElementById(id);
  const BRIDGE = window.parent !== window && new URLSearchParams(location.search).get('bridge') === '1';
  const WATCHDOG_MS = 5000;
  const FX = window.CampaignFx || null;                    // ?fx=a (fx-a.js): the election-night graphics pass. null = today's look, and none of its branches run

  // ---------------------------------------------------------------- state
  const S = {
    seen: {}, ready: false, st: null, mode: 'play', wallet: { play: null, chips: null }, run: null, view: 'boot', busy: false, pending: null,
    home: null, bet: null, again: null, lastEnd: null, whole: false, offline: false, skew: 0, tk: [], events: [], q: '', listOpen: false, wd: 0, askedAt: 0
  };
  window.__campaign = { get ready() { return S.ready; }, get run() { return S.run; }, get busy() { return S.busy; }, get lastEnd() { return S.lastEnd; }, get events() { return S.events; }, get view() { return S.view; }, S };
  const log = (dir, event, payload) => { S.events.push({ t: Date.now(), dir, event, payload }); if (S.events.length > 300) S.events.shift(); };
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mapStates = () => (S.st && S.st.map && S.st.map.states) || {};
  const nameOf = (c) => (mapStates()[c] && mapStates()[c].name) || c;
  const tierOf = (c) => (mapStates()[c] && mapStates()[c].tier) || 'safe';
  const partyOf = (c) => (mapStates()[c] && mapStates()[c].party) || 'R';
  const modeLabel = (m) => (m === 'chips' ? 'CHIPS' : 'CASH');
  const fmt = (n, m) => C.money(n, m || S.mode);
  let map = null;

  // ---------------------------------------------------------------- requests: one in flight, a watchdog that re-asks state
  function send(event, payload) {
    if (S.busy || S.offline) return false;
    S.busy = true; S.pending = event; paint(); log('out', event, payload);
    toParent({ type: 'req', event, payload });
    clearTimeout(S.wd); S.wd = setTimeout(() => { if (S.busy) { log('out', 'watchdog', {}); askState(); } }, WATCHDOG_MS);
    return true;
  }
  function askState() { S.askedAt = Date.now(); log('out', 'state', {}); toParent({ type: 'req', event: 'state', payload: {} }); }
  function release() { S.busy = false; S.pending = null; clearTimeout(S.wd); }

  // ---------------------------------------------------------------- incoming
  addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return; const m = ev.data || {};
    if (m.type === 'init') onInit(m);
    else if (m.type === 'wallet') { applyWallet(m.wallet); paint(); }
    else if (m.type === 'pref') { paint(); if (S.view === 'run' || S.view === 'ended') redrawMap(false); }
    else if (m.type === 'ev') { log('in', m.event, m.payload); if (FX && FX.gate(() => onEvent(m.event, m.payload || {}))) return; onEvent(m.event, m.payload || {}); }   // FX only adds time: an answer that lands during the count is applied when the count ends
    else if (m.type === 'disconnect') { S.offline = true; $('offline').hidden = false; paint(); }
    else if (m.type === 'mode') { if (!S.run && (m.mode === 'play' || m.mode === 'chips')) { S.mode = m.mode; paint(); } }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('sheet').hidden) closeSheet(); else toParent({ type: 'esc' }); } });

  function applyWallet(w) { if (!w) return; if (typeof w.play === 'number') S.wallet.play = w.play; if (typeof w.chips === 'number') S.wallet.chips = w.chips; }
  function noteFresh(run) { if (run && typeof run.expiresAt === 'number' && run.idleMs) S.skew = (run.expiresAt - run.idleMs) - Date.now(); }

  function onInit(m) {
    S.offline = false; $('offline').hidden = true;
    if (m.mode === 'play' || m.mode === 'chips') S.mode = m.mode;
    applyWallet(m.wallet); log('in', 'init', { mode: m.mode });
    if (m.state) onState(m.state);
  }
  function onState(st) {
    release(); S.st = st; applyWallet(st.balances); if (FX) FX.clear();          // a resync never leaves a count or a strap on the screen
    if (!map) buildMap();
    if (!S.bet || !(st.betLevels || []).includes(S.bet)) S.bet = pickDefaultBet(st.betLevels || []);
    S.ready = true;
    if (st.run) { adopt(st.run, true); return; }
    if (S.run) { S.run = null; toast('Your run ended while you were away.'); }       // the end was missed: the wallet already holds the result
    if (S.view !== 'ended') setView('setup');
    paint(); redrawMap(false);
  }
  function pickDefaultBet(levels) { return levels.includes(100) ? 100 : levels[0] || null; }

  function onEvent(event, p) {
    if (event === 'state') return onState(p);
    if (event === 'run') { release(); applyWallet(p.balances); noteFresh(p.run); adopt(p.run, false); return; }
    if (event === 'step') return onStep(p);
    if (event === 'end') return onEnd(p);
    if (event === 'error') return onError(p);
  }

  function adopt(run, quiet) {
    const isNew = !S.run || S.run.roundId !== run.roundId;
    rememberOdds(run); S.run = run; if (run.mode && run.mode !== S.mode) toParent({ type: 'mode', mode: run.mode }); S.mode = run.mode || S.mode;   // keep the shell's mode on the run's currency, or a resync after a reload flips the game to the other one S.bet = run.bet; S.home = run.home; S.again = { home: run.home, bet: run.bet, mode: run.mode };
    S.lastEnd = null; setView('run'); if (isNew) { S.tk = []; S.whole = false; }
    if (FX) { if (isNew && !quiet) FX.open(); else FX.clear(); }
    if (isNew && !quiet) tick(C.news('open', { S: nameOf(run.home) }, run.roundId));
    else if (isNew) tick(run.steps ? 'Back on the trail in ' + nameOf(run.at) + '.' : 'Polls are open in ' + nameOf(run.home) + '.', true);
    release(); paint(); redrawMap(false);
    if (run.steps === 0) bump('mx');
  }

  function onStep(p) {
    if (!S.run || p.roundId !== S.run.roundId) { askState(); return; }
    if (!p.run || p.run.steps <= S.run.steps) { log('in', 'ignored_step', { n: p.n }); return; }   // an answer for an old n
    const prev = S.run, op = (prev.options || []).find((o) => o.to === p.to);
    S.run = p.run; rememberOdds(p.run); noteFresh(p.run); release();
    tick(C.news(p.tier || (op && op.tier) || tierOf(p.to), { S: nameOf(p.to), P: op ? C.pctOf(op.g100) : C.mxText(p.run.mx) }, p.roundId + ':' + p.run.steps));
    paint(); redrawMap(true); bump('mx'); bump('cards');
    if (FX) FX.called({ to: p.to, name: nameOf(p.to), tier: p.tier || (op && op.tier) || 'safe', gain: op ? C.pctOf(op.g100) : '', mx: C.mxText(p.run.mx), mxFrom: prev.mx, mxTo: p.run.mx, mxFmt: C.mxText, n: p.run.trail.length });
    else if (map) map.pop(p.run.at, op ? C.pctOf(op.g100) : '', p.tier || (op && op.tier) || 'safe');
  }

  function onEnd(p) {
    release(); applyWallet(p.balances);
    if (S.run && p.roundId !== S.run.roundId) { paint(); return; }
    if (!S.run && S.view !== 'run') { paint(); return; }               // nothing of ours is open: just the wallet
    S.lastEnd = p; S.run = null; S.again = { home: (p.trail && p.trail[0]) || S.home, bet: p.bet, mode: p.mode };
    S.mode = p.mode || S.mode; S.bet = p.bet; setView('ended');
    const R = p.reason, refund = (p.steps || 0) === 0 && R !== 'scandal';
    if (refund) tick(C.news('withdrawn', {}, p.roundId));
    else if (R === 'scandal') tick(C.news('scandal', { S: nameOf(p.failedAt) }, p.roundId));
    else if (R === 'deadend') tick(C.news('deadend', { S: nameOf(p.at) }, p.roundId));
    else if (R === 'landslide') tick(C.news('landslide', { S: nameOf(p.at) }, p.roundId));
    else tick(C.news(R === 'cashout' ? 'cashout' : R === 'withdrawn' ? 'withdrawn' : R === 'timeout' ? 'timeout' : 'boot', { S: nameOf(p.at) }, p.roundId));
    paint(); redrawMap(true);
    if (FX) {
      const money = (n) => fmt(n, p.mode);
      if (R === 'scandal') FX.bust({ to: p.failedAt, name: nameOf(p.failedAt), mx: C.mxText(p.mx), lost: money(p.bet), news: S.tk[0] });
      else if (R === 'landslide') FX.landslide({ win: p.win, fmt: money, mx: C.mxText(p.mx) });
      else if (p.win > 0 && !refund) FX.victory({ tag: (REASON[R] || REASON.cashout)[0], trail: p.trail, win: p.win, fmt: money, mx: C.mxText(p.mx), states: (p.trail || []).length });
      else FX.clear();
    } else if (R === 'scandal') scandalFx(p.failedAt); else if (p.win > 0 && R !== 'withdrawn') winFx(R === 'landslide');
  }

  function onError(e) {
    const code = e && e.code, ctx = S.pending === 'cash' || S.pending === 'step' || S.pending === 'start' ? S.pending : ''; if (FX) FX.clear();
    if (code === 'run_open') { release(); if (e.run) { noteFresh(e.run); adopt(e.run, true); } else askState(); toast(C.errorText('run_open', ctx)); return; }
    if (code === 'rate') { release(); paint(); toast(C.errorText('rate', ctx)); return; }
    if (code === 'bad_step' || code === 'no_run') { release(); askState(); return; }
    release(); paint();
    toast(C.errorText(code, ctx, e && e.message));
    if (code === 'internal') askState();
  }

  // ---------------------------------------------------------------- actions
  function pick(to) {
    if (S.view !== 'run' || !S.run || S.busy || S.offline) return;
    if (!(S.run.options || []).some((o) => o.to === to)) return;
    const op = S.run.options.find((o) => o.to === to), from = S.run.at, mode = S.run.mode;
    S.pendingTo = to; if (send('step', { roundId: S.run.roundId, n: S.run.steps + 1, to }) && FX) FX.suspense({ from, to, name: op.name, tier: op.tier, final: !!op.landslide, pay: fmt(op.nextCashout, mode) });
  }
  function cash() { if (S.view === 'run' && S.run && S.run.canCash && !S.busy) send('cash', { roundId: S.run.roundId }); }
  function start() {
    if (S.view !== 'setup' || !S.home || !S.bet || S.busy) return;
    S.again = { home: S.home, bet: S.bet, mode: S.mode }; send('start', { mode: S.mode, bet: S.bet, home: S.home });
  }
  function again() {
    if (S.view !== 'ended' || S.busy) return; const a = S.again; if (!a) return;
    S.home = a.home; S.bet = a.bet; S.mode = a.mode || S.mode; send('start', { mode: S.mode, bet: S.bet, home: S.home });
  }
  function toSetup() { if (S.busy || S.run) return; if (FX) FX.clear(); S.lastEnd = null; setView('setup'); paint(); redrawMap(true); }
  function setHome(code) {
    if (S.view !== 'setup' || !mapStates()[code]) return; S.home = code; S.q = ''; S.listOpen = false; const f = document.getElementById('homeQ'); if (f) f.blur(); paint(); redrawMap(false);
  }
  function setMode(m) { if (S.run || S.busy || (m !== 'play' && m !== 'chips')) return; S.mode = m; toParent({ type: 'mode', mode: m }); paint(); }
  function setBet(n) { if (S.view === 'setup') { S.bet = n; S.listOpen = false; const f = document.getElementById('homeQ'); if (f) f.blur(); paint(); } }
  function toggleWhole() { S.whole = !S.whole; $('wholeBtn').setAttribute('aria-pressed', S.whole); $('wholeBtn').textContent = S.whole ? 'Follow' : 'Whole map'; redrawMap(true); }

  $('app').addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]'); if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    const a = t.dataset.action;
    if (a === 'pick') pick(t.dataset.to);
    else if (a === 'cta') { const v = S.view; if (v === 'setup') start(); else if (v === 'run') cash(); else if (v === 'ended') again(); }
    else if (a === 'cash') cash(); else if (a === 'start') start(); else if (a === 'again') again();
    else if (a === 'setup') toSetup();
    else if (a === 'home') setHome(t.dataset.s);
    else if (a === 'mode') setMode(t.dataset.m);
    else if (a === 'bet') setBet(+t.dataset.b);
    else if (a === 'whole') toggleWhole();
    else if (a === 'rules') openSheet();
    else if (a === 'more') scrollMore();
    else if (a === 'close') closeSheet();
  });

  // ---------------------------------------------------------------- map
  function buildMap() {
    const m = S.st.map || {};
    map = CampaignMap($('board'), window.CAMPAIGN_GEO, { states: m.states || {}, air: m.air || [] }, { pick: (c) => { if (S.view === 'setup') setHome(c); else pick(c); } });
    if (FX) FX.attach(map);
  }
  function redrawMap(animate) {
    if (!map) return;
    const r = S.run, e = S.lastEnd;
    if (S.view === 'run' && r) map.draw({ mode: 'run', home: r.home, at: r.at, trail: r.trail, options: r.options.map((o, i) => Object.assign({ n: i + 1 }, o)), whole: S.whole }, { animate, animateLast: animate && r.steps > 0 });
    else if (S.view === 'ended' && e) map.draw({ mode: 'end', trail: e.trail, at: e.at, failedAt: e.failedAt }, { animate });
    else map.draw({ mode: 'setup', home: S.home, trail: [] }, { animate });
  }

  // ---------------------------------------------------------------- effects
  function scandalFx(code) {
    const b = $('board'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    const sh = $('shock'); sh.className = ''; void sh.offsetWidth; sh.className = 'bad';
    if (map) map.flash(code, 'bad');
  }
  function winFx(big) { const sh = $('shock'); sh.className = ''; void sh.offsetWidth; sh.className = big ? 'ls' : 'good'; }
  function bump(what) {
    const n = what === 'mx' ? $('mxv') : $('panel'); if (!n) return;
    const cls = what === 'mx' ? 'bump' : 'deal'; n.classList.remove(cls); void n.offsetWidth; n.classList.add(cls);
  }
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), Math.max(2600, 1600 + msg.length * 55)); }
  function tick(text, quiet) {
    S.tk.unshift(text); paintLog(); const nw = $('tkNew'), old = $('tkOld'); old.textContent = S.tk[1] || ''; nw.innerHTML = '<span>' + esc(text) + '</span>';
    nw.classList.remove('in');                                   // the headline wraps to as many lines as it needs: it is never cut or scrolled
    if (!quiet) { void nw.offsetWidth; nw.classList.add('in'); }
  }

  function paintLog() { $('log').hidden = !S.tk.length; $('logList').innerHTML = S.tk.slice(0, 12).map((t, i) => '<p' + (/^SCANDAL/.test(t) ? ' class="bad"' : i === 0 ? ' class="new"' : '') + '>' + esc(t) + '</p>').join(''); }

  // ---------------------------------------------------------------- view
  function setView(v) { S.view = v; $('app').dataset.state = v; }
  function paint() {
    $('app').dataset.state = S.view; $('app').dataset.busy = S.busy ? '1' : '0'; $('app').dataset.mode = S.mode; $('app').dataset.list = S.view === 'setup' && S.listOpen ? '1' : '0';
    paintHeader(); paintPanel(); paintCta(); tickRing(); fitHeader(); document.querySelectorAll('.figs dd').forEach((d) => fitText(d, 16)); document.querySelectorAll('.card .nm').forEach((d) => fitText(d, 14)); updateMore();
  }
  function paintHeader() {
    const r = S.run, e = S.lastEnd, v = S.view;
    const mx = r ? r.mx : e ? e.mx : 100;
    const dead = v === 'ended' && e && e.reason === 'scandal';       // a lost round shows SCANDAL, not a multiplier that paid nothing (the panel keeps "WAS AT 1.25x")
    $('mxv').textContent = dead ? 'SCANDAL' : C.mxText(mx); $('mxv').dataset.dead = dead ? '1' : '0'; $('mxl').textContent = dead ? 'RESULT' : 'MULTIPLIER';
    const bet = r ? r.bet : e ? e.bet : S.bet, mode = r ? r.mode : e ? e.mode : S.mode;
    $('stkv').textContent = bet != null ? fmt(bet, mode) : '--'; $('stkc').textContent = modeLabel(mode);
    const w = S.wallet[mode]; $('bal').textContent = typeof w === 'number' ? fmt(w, mode) : '--';
    const carried = r ? r.trail.length : e ? (e.reason === 'scandal' ? e.trail.length : e.trail.length) : 0; $('carried').textContent = String(v === 'setup' || v === 'boot' ? 0 : carried);
    paintModeSw(); $('wholeBtn').hidden = v !== 'run'; $('wholeBtn').textContent = S.whole ? 'Follow' : 'Whole map';
  }
  function paintModeSw() {
    const sw = $('modeSw'), modes = (S.st && S.st.modes) || ['play', 'chips'];
    if (!sw.dataset.built) { sw.innerHTML = modes.map((m) => '<button type="button" class="segb" data-action="mode" data-m="' + m + '">' + modeLabel(m) + '</button>').join(''); sw.dataset.built = '1'; }
    for (const b of sw.children) { b.classList.toggle('on', b.dataset.m === S.mode); b.setAttribute('aria-pressed', b.dataset.m === S.mode); b.disabled = S.busy; }
  }
  function paintCta() {
    const b = $('cta'), main = b.querySelector('.main'), sub = b.querySelector('.sub'), v = S.view, r = S.run, bet = S.bet;
    let act = 'start', label = 'LOADING', note = '', dis = true;
    if (v === 'setup') {
      act = 'start'; label = S.home ? 'START CAMPAIGN' : 'PICK A HOME STATE'; note = S.home ? fmt(S.bet) + ' on ' + nameOf(S.home) : 'tap the map, or search above';
      const have = S.wallet[S.mode]; const short = typeof have === 'number' && S.bet != null && have < S.bet;
      dis = !S.home || !S.bet || S.busy || S.offline || short; if (short && S.home) note = 'not enough ' + (S.mode === 'chips' ? 'chips' : 'Cash');
    } else if (v === 'run' && r) {
      act = 'cash'; dis = !r.canCash || S.busy || S.offline;
      if (r.steps === 0) { label = 'WITHDRAW, stake back'; note = fmt(r.cashout, r.mode) + ' returned'; }
      else { label = 'DECLARE VICTORY  ' + fmt(r.cashout, r.mode); note = 'cash out at ' + C.mxText(r.mx); }
    } else if (v === 'ended') {
      act = 'again'; const a = S.again || {}; label = 'PLAY AGAIN'; note = a.bet != null ? fmt(a.bet, a.mode) + ' from ' + nameOf(a.home) : '';
      const have = S.wallet[a.mode || S.mode]; dis = S.busy || S.offline || !a.home || (typeof have === 'number' && have < a.bet); if (typeof have === 'number' && have < a.bet) note = 'not enough ' + ((a.mode || S.mode) === 'chips' ? 'chips' : 'Cash');
    }
    const unit = (m) => (m === 'chips' ? 'Chips' : 'Cash'); let warn = '';
    if (v === 'setup' && S.home && !S.busy && typeof S.wallet[S.mode] === 'number' && S.bet != null && S.wallet[S.mode] < S.bet) warn = 'Not enough ' + unit(S.mode) + ' for this stake. Pick a smaller stake.';
    if (v === 'ended' && S.again && !S.busy && typeof S.wallet[S.again.mode || S.mode] === 'number' && S.wallet[S.again.mode || S.mode] < S.again.bet) warn = 'Not enough ' + unit(S.again.mode || S.mode) + ' for the same stake. Use Change home or stake.';
    const bn = $('barNote'); bn.hidden = !warn; bn.textContent = warn;
    if (S.busy) note = S.pending === 'step' ? 'counting the votes...' : S.pending === 'cash' ? 'calling it...' : 'working...';
    b.dataset.action = act; b.disabled = dis; main.textContent = label; sub.textContent = note; b.dataset.act = act;
    $('bar').dataset.ring = v === 'run' ? '1' : '0'; fitMain(main);
  }

  const textW = (n) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().width; };   // ellipsis boxes report no overflow through scrollWidth
  function fitText(n, min) { n.style.fontSize = ''; let fs = parseFloat(getComputedStyle(n).fontSize), guard = 0; while (textW(n) > n.clientWidth - 0.2 && fs > min && guard++ < 14) { fs -= 0.5; n.style.fontSize = fs + 'px'; } }
  function fitHeader() {
    const hd = $('hd'), mx = $('mxv'), st = $('stkv'), bal = $('bal'); mx.style.fontSize = ''; st.style.fontSize = ''; bal.style.fontSize = '';
    const nat = (n) => { n.style.width = 'max-content'; const w = n.getBoundingClientRect().width; n.style.width = ''; return w; };
    const cs = getComputedStyle(hd), gap = parseFloat(cs.columnGap) || 0, avail = hd.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 44 - 3 * gap;
    let guard = 0;
    while (nat(mx) + Math.max(nat(st), nat($('stkc'))) + nat(bal) > avail && guard++ < 30) {
      const m = parseFloat(getComputedStyle(mx).fontSize);
      if (m > 28) mx.style.fontSize = (m - 2) + 'px'; else { const s = parseFloat(getComputedStyle(bal).fontSize); if (s <= 15) break; bal.style.fontSize = (s - 1) + 'px'; st.style.fontSize = (s - 1) + 'px'; }
    }
  }
  function fitMain(n) {                                    // a long label (big amounts) shrinks to fit the button instead of being cut
    const max = parseFloat(getComputedStyle(document.body).getPropertyValue('--cta-fs')) || 0; n.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(n).fontSize), guard = 0; while (n.scrollWidth > n.clientWidth + 1 && fs > 15 && guard++ < 14) { fs -= 1; n.style.fontSize = fs + 'px'; }
  }
  // ---- idle ring (driven by expiresAt)
  const CIRC = 2 * Math.PI * 20; let ringState = '';
  function tickRing() {
    const arc = document.querySelector('#ring .arc'), n = $('ringN'), r = S.run;
    if (S.view !== 'run' || !r) { $('ring').dataset.low = '0'; return; }
    const left = Math.max(0, r.expiresAt - S.skew - Date.now()), frac = Math.min(1, left / (r.idleMs || 60000)), sec = Math.ceil(left / 1000);
    arc.style.strokeDasharray = CIRC.toFixed(1); arc.style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(1);
    n.textContent = String(sec); $('ring').dataset.low = left < 10000 ? '1' : '0';
    const sub = $('cta').querySelector('.sub');
    if (!S.busy) sub.textContent = (left > 0 ? 'auto cash-out in ' + sec + 's' : 'auto cash-out now') + (r.steps ? '  -  ' + C.mxText(r.mx) : '');
    if (left <= 0 && Date.now() - S.askedAt > 3000 && !S.busy) askState();   // the server should have closed it: make sure we heard
  }
  setInterval(tickRing, 250);

  // ---------------------------------------------------------------- panel
  function tierChip(t) { return '<i class="chip c-' + t + '">' + t.toUpperCase() + '</i>'; }
  function paintPanel() {
    const p = $('panel'), v = S.view; p.dataset.view = v;
    if (v === 'boot') { p.innerHTML = '<div class="boot">' + (BRIDGE ? 'Dialing the studio...' : 'Open Campaign Trail from The Ping.') + '</div>'; return; }
    if (v === 'setup') return paintSetup(p);
    if (v === 'run') return paintCards(p);
    if (v === 'ended') return paintResult(p);
  }
  function homeList() {
    const q = S.q.trim().toLowerCase(), st = mapStates();
    return Object.keys(st).filter((c) => !q || st[c].name.toLowerCase().includes(q) || c.toLowerCase() === q).sort((a, b) => st[a].name.localeCompare(st[b].name)).slice(0, 50);
  }
  function renderList() {
    const box = document.getElementById('homeListBox'); if (!box) return; $('app').dataset.list = S.view === 'setup' && S.listOpen ? '1' : '0';
    if (!S.listOpen) { box.innerHTML = ''; updateMore(); return; }
    const list = homeList();
    box.innerHTML = '<div id="homeList" class="hlist" role="listbox">' + (list.length ? list.map((c) => '<button type="button" class="hrow" data-action="home" data-s="' + esc(c) + '" role="option">' + '<b>' + esc(nameOf(c)) + '</b>' + tierChip(tierOf(c)) + '</button>').join('') : '<p class="none">No such state.</p>') + '</div>';
    updateMore();
  }
  function paintSetup(p) {
    const lv = (S.st && S.st.betLevels) || [];
    const cur = document.getElementById('homeQ');
    if (cur && document.activeElement === cur) { renderList(); return; }         // never rebuild the field while the player is typing in it
    const homeLine = '<div class="homeline"><label for="homeQ">HOME</label>' + (S.home ? '<b>' + esc(nameOf(S.home)) + '</b>' + tierChip(tierOf(S.home)) + '' : '<b class="ph">tap the map, or search</b>') + '</div>';
    p.innerHTML =
      '<div class="setup">' + homeLine +
      '<div class="seg bets" role="radiogroup" aria-label="Stake"><span class="legend">STAKE</span>' + lv.map((n) => '<button type="button" class="segb' + (n === S.bet ? ' on' : '') + '" data-action="bet" data-b="' + n + '" role="radio" aria-checked="' + (n === S.bet) + '">' + fmt(n) + '</button>').join('') + '</div>' +
      '<div class="homeRow"><input id="homeQ" class="find" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search 50 states" value="' + esc(S.q) + '" aria-label="Search for a home state"><div id="homeListBox"></div></div>' +
      '<div class="lgnd" aria-hidden="true"><i class="lg safeR"></i><i class="lg safeD"></i><span>SAFE</span><i class="lg leanR"></i><i class="lg leanD"></i><span>LEAN</span><i class="lg swing"></i><span>SWING</span></div>' +
      '</div>';
    renderList();
    const q = document.getElementById('homeQ');
    q.addEventListener('focus', () => { if (!S.listOpen) { S.listOpen = true; renderList(); } });
    q.addEventListener('input', () => { S.q = q.value; S.listOpen = true; renderList(); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const l = homeList(); if (l.length) setHome(l[0]); q.blur(); } if (e.key === 'Escape') { S.listOpen = false; S.q = ''; q.value = ''; q.blur(); renderList(); } });
  }
  function optCard(o, i, run) {
    const gain = C.pctOf(o.g100), tags = [];
    if (o.deadEnd) tags.push('<i class="tag dead">DEAD END</i>'); if (o.landslide) tags.push('<i class="tag ls">LANDSLIDE</i>');
    const pend = S.pendingTo === o.to && S.busy;
    return '<button type="button" class="card t-' + o.tier + ' p-' + partyOf(o.to) + (o.landslide ? ' ls' : '') + (o.deadEnd ? ' dead' : '') + (pend ? ' pend' : '') + '" data-action="pick" data-to="' + esc(o.to) + '" data-n="' + (i + 1) + '" data-tier="' + o.tier + '"' + (S.busy ? ' aria-disabled="true"' : '') + '>' +
      '<i class="num">' + (i + 1) + '</i>' + (o.landslide ? '<i class="sheen"></i>' : '') +
      '<span class="nm">' + esc(o.name) + '</span>' + (o.landslide ? '' : tierChip(o.tier)) +
      '<span class="gr">' + (o.landslide ? '<b>FINAL</b> pays ' : '<b>' + gain + '</b> to ') + C.mxText(o.nextMx) + '</span>' +
      '<span class="pay">' + fmt(o.nextCashout, run.mode) + '</span>' +
      '<span class="od">' + (o.landslide ? C.oddsFinal(o.pFail) : C.oddsWords(o.pFail)) + '</span>' + (tags.length ? '<span class="tags">' + tags.join('') + '</span>' : '') + '</button>';
  }
  function paintCards(p) {
    const r = S.run; if (!r) { p.innerHTML = ''; return; }
    const opts = r.options || [];
    const first = r.steps === 0 ? '<p class="first"><b>First step:</b> the risky one (house edge).</p>' : '';
    p.innerHTML = first + '<div class="cards" data-n="' + opts.length + '">' + (opts.length ? opts.map((o, i) => optCard(o, i, r)).join('') : '<p class="none">No states left to pick.</p>') + '</div>';
  }
  const REASON = {
    scandal: ['SCANDAL', 'bad'], cashout: ['VICTORY DECLARED', 'good'], withdrawn: ['WITHDRAWN', 'neutral'], timeout: ['TIME\'S UP', 'good'],
    deadend: ['OUT OF ROAD', 'good'], landslide: ['LANDSLIDE', 'ls'], boot: ['COUNT INTERRUPTED', 'good']
  };
  function paintResult(p) {
    const e = S.lastEnd; if (!e) { p.innerHTML = ''; return; }
    const t = ((e.steps || 0) === 0 && e.reason !== 'scandal') ? REASON.withdrawn : (REASON[e.reason] || ['RESULT', 'neutral']);
    const refund = (e.steps || 0) === 0 && e.reason !== 'scandal';
    const sub = refund ? 'stake back' : e.reason === 'scandal' ? 'in ' + nameOf(e.failedAt) : e.reason === 'timeout' ? 'auto cash-out' : e.reason === 'deadend' ? 'victory declared in ' + nameOf(e.at) : e.reason === 'landslide' ? 'all 50 states' : e.reason === 'withdrawn' ? 'stake back' : e.reason === 'boot' ? 'cashed out at your standing' : 'in ' + nameOf(e.at);
    const route = (e.trail || []).map((c) => '<i>' + c + '</i>').join('');
    p.innerHTML = '<div class="result k-' + t[1] + '"><div class="stamp"><b>' + t[0] + '</b><span>' + esc(sub) + '</span></div>' +
      '<dl class="figs"><div><dt>STAKE</dt><dd>' + fmt(e.bet, e.mode) + '</dd></div><div><dt>' + (e.reason === 'scandal' ? 'WAS AT' : 'MULTIPLIER') + '</dt><dd>' + C.mxText(e.mx) + '</dd></div><div class="paid"><dt>' + (refund ? 'RETURNED' : 'PAID') + '</dt><dd>' + fmt(e.win, e.mode) + '</dd></div></dl>' +
      '<div class="route" aria-label="Route"><div class="rh"><small>ROUTE: ' + (e.trail || []).length + ' STATE' + ((e.trail || []).length === 1 ? '' : 'S') + '</small><button type="button" class="link" data-action="setup">Change home or stake</button></div><div class="rl">' + route + (e.reason === 'scandal' ? '<i class="x">' + e.failedAt + '</i>' : '') + '</div></div></div>';
  }

  // ---------------------------------------------------------------- scroll cue: the panel scrolls, so say what is below
  function updateMore() {
    const p = $('panel'), m = $('more'); if (!p || !m) return;
    const hidden = p.scrollHeight - p.clientHeight - p.scrollTop > 6;
    $('panelWrap').dataset.more = hidden ? '1' : '0';
    if (!hidden) { m.hidden = true; return; }
    let n = 0; const pr = p.getBoundingClientRect(); p.querySelectorAll('.cards .card').forEach((c) => { if (c.getBoundingClientRect().bottom > pr.bottom - 4) n++; });
    m.firstChild.textContent = (n ? n + ' more option' + (n === 1 ? '' : 's') : 'more') + '  \u25BE'; m.hidden = false;
  }
  $('panel').addEventListener('scroll', updateMore, { passive: true });
  function scrollMore() { const p = $('panel'); p.scrollBy({ top: Math.max(60, p.clientHeight - 36), behavior: 'smooth' }); }

  // ---------------------------------------------------------------- rules sheet
  // Odds shown in the rules sheet are only ever what the server sent for an option in this session (pFail through oddsWords): the client holds no odds formula.
  function rememberOdds(run) { if (!run) return; const k = run.steps === 0 ? 'first' : 'later'; for (const o of run.options || []) { (S.seen[o.tier] || (S.seen[o.tier] = {}))[k] = o.pFail; } }
  function openSheet() {
    const st = S.st || {}, tiers = (st.map && st.map.tiers) || {}, row = (t) => { if (!tiers[t]) return ''; const sn = Object.assign({}, S.seen[t] || {}, (st.odds && st.odds[t]) || {}), w = (v) => (typeof v === 'number' ? C.oddsWords(v) : 'see the card'); return '<tr><th>' + tierChip(t) + '</th><td>+' + (tiers[t].g100 - 100) + '%</td><td>' + w(sn.first) + '</td><td>' + w(sn.later) + '</td></tr>'; };
    const idle = Math.round((st.idleMs || 60000) / 1000);
    $('sheet').innerHTML = '<div class="sh-card"><header><h2>HOW IT WORKS</h2><button type="button" class="ibtn" data-action="close" aria-label="Close">x</button></header><div class="sh-body">' +
      '<ol class="steps"><li><b>Pick a home state</b> and a stake. You start at 1.00x.</li><li><b>Pick the next state</b> from the unvisited states that border where you stand. Each state has a risk tier.</li><li>A step that survives <b>multiplies your multiplier</b>. A step that fails is a <b>SCANDAL</b> and the stake is lost.</li><li>After any surviving step you may <b>declare victory</b> and be paid stake x multiplier. Before the first step, withdrawing gives the stake back.</li><li>A state counts once per run. Carry all 50 and it is a <b>LANDSLIDE</b>.</li></ol>' +
      '<table class="odds"><thead><tr><th>TIER</th><th>GROWTH</th><th>FIRST STEP</th><th>LATER STEPS</th></tr></thead><tbody>' + row('safe') + row('lean') + row('swing') + '</tbody></table>' +
      '<p>Every option card shows its own exact odds in words. The table fills in from the cards you have seen this session; until then it says "see the card". <b>The first step carries the house edge</b>: it is worse than fair. Every step after it is exactly fair.</p>' +
      '<ul class="facts"><li>Return to player <b>' + esc(st.rtp || '96.0%') + '</b>, on every route and every stop point.</li><li>Largest win <b>' + (st.maxWinX || 1000).toLocaleString('en-US') + 'x</b> (the LANDSLIDE step). Hard cap ' + (st.capX || 10000).toLocaleString('en-US') + 'x.</li><li>Idle for <b>' + idle + ' seconds</b> and you are cashed out automatically at your current multiplier.</li><li>If the server restarts, an open run is <b>cashed out at your current multiplier</b>.</li><li>Alaska and Hawaii are reached by the dashed air links: Washington, Hawaii and California.</li><li>Cash and Chips never mix. Chips have no cash value.</li></ul>' +
      '<div class="key"><span><i class="lg safeR"></i><i class="lg safeD"></i> SAFE deep red / blue</span><span><i class="lg leanR"></i><i class="lg leanD"></i> LEAN lighter</span><span><i class="lg swing"></i> SWING gold and violet</span></div>' +
      '</div></div>';
    $('sheet').hidden = false; $('sheet').querySelector('.ibtn').focus();
  }
  function closeSheet() { $('sheet').hidden = true; }
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  // ---------------------------------------------------------------- go
  setView('boot'); paint(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => paintCta()); addEventListener('resize', () => { paintCta(); updateMore(); });
  if (BRIDGE) { toParent({ type: 'hello' }); setInterval(() => { if (!S.ready && !S.offline) toParent({ type: 'hello' }); }, 3000); }
})();
