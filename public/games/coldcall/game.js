/* COLD CALL: UI controller. The server resolves a whole round and returns a script; this file only ANIMATES it (reels, win highlights,
   counters, big-win overlay). Bonus screens live in rotary.js and quote.js and talk to this file through CC.core.
   Money: integer cents everywhere; a tenth-of-bet amount t is t * bet / 10 cents (exact at every bet level). */
(() => {
  const CC = (window.CC = window.CC || {});
  const $ = (id) => document.getElementById(id);
  const E = ColdCallEngine, COLS = E.COLS, ROWS = E.ROWS;
  const Q = new URLSearchParams(location.search);
  const SFX_ = SFX;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BRIDGE = Q.get('bridge') === '1' && window.parent !== window;
  const LIVE_SOCKET = !BRIDGE && Q.get('live') === '1';
  const DEFAULT_BETS = E.BET_LEVELS.slice();
  const QFORCE = ['rotary', 'quote', 'big'].includes(Q.get('force')) ? Q.get('force') : null;   // practice/QA only; the server ignores it unless COLDCALL_TEST=1
  const REG = ['cash', 'pile', 'rx', 'headset', 'can', 'mug', 'note', 'ball'];
  const NAMES = { cash: 'Cash', pile: 'Pile', rx: 'Rx bottle', headset: 'Headset', can: 'Energy can', mug: 'Mug', note: 'Sticky note', ball: 'Stress ball', closer: 'The Closer (wild)', phone: 'Rotary phone', quote: 'Quote bubble', upsell: 'Upsell' };
  const TIER_NAME = { big: 'BIG WIN', huge: 'HUGE WIN', mega: 'MEGA WIN', legend: 'LEGENDARY' };
  const TIER_LVL = { big: 1, huge: 2, mega: 3, legend: 4 };

  const stage = $('stage'), app = $('app'), board = $('board'), reelsEl = $('reels'), floatsEl = $('floats'), ov = $('ov'), sceneEl = $('scene');
  const css = getComputedStyle(document.documentElement);
  const num = (v, d) => { const n = parseFloat(css.getPropertyValue(v)); return Number.isFinite(n) ? n : d; };
  const CELL = num('--cell', 94), GAP = num('--gap', 5), PITCH = CELL + GAP;

  // ------------------------------------------------------------------ state
  const st = { bets: DEFAULT_BETS.slice(), betIdx: 3, busy: false, auto: false, turbo: false, skip: false, tap: 0, mode: 'play', live: false, s: 1,
    bal: 100000, balShown: 100000, winShown: 0, winTarget: 0, grid: null, modal: 0, pracBal: 100000, server: null, rounds: 0 };
  const money = { wallet: { play: 0, ledgerNet: 0, ledgerLimit: -50000 } };
  const bet = () => st.bets[st.betIdx];
  const dollars = (c) => { const n = Math.round(c), a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
  const boxFmt = (c) => { c = Math.round(c); if (c >= 100000) return '$' + (c / 100000).toFixed(c % 100000 ? 1 : 0).replace(/\.0$/, '') + 'k'; if (c >= 10000) return '$' + Math.round(c / 100); if (c >= 100) return '$' + (c / 100).toFixed(2).replace(/\.?0+$/, ''); return c + 'c'; };
  const costT = (kind) => (kind === 'spin' ? 10 : (st.server && st.server.buyCostX ? Math.round(st.server.buyCostX[kind] * 10) : E.CFG.buyCost[kind]));
  const walletBal = () => (st.mode === 'ledger' ? money.wallet.ledgerNet : money.wallet.play);
  const avail = () => (st.live ? (st.mode === 'ledger' ? money.wallet.ledgerNet - (money.wallet.ledgerLimit ?? -50000) : money.wallet.play) : st.pracBal);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const rand = (a, b) => a + Math.random() * (b - a);
  const dbg = (CC.dbg = { mismatch: [], rounds: [], calls: 0 });

  // ------------------------------------------------------------------ one shared rAF ticker (count-ups). The other loop is fx.js.
  const Tick = (() => { const fns = new Set(); let raf = 0; const loop = (now) => { for (const f of [...fns]) if (!f(now)) fns.delete(f); raf = fns.size ? requestAnimationFrame(loop) : 0; }; return { add(f) { fns.add(f); if (!raf) raf = requestAnimationFrame(loop); } }; })();

  // ------------------------------------------------------------------ layout
  function fit() {
    const H = Math.max(960, Math.min(1250, Math.round(540 * innerHeight / innerWidth)));
    st.s = Math.min(innerWidth / 540, innerHeight / H);
    stage.style.setProperty('--H', H + 'px'); stage.style.setProperty('--s', st.s);
    const cv = $('fx'); if (cv.height !== H) { cv.width = 540; cv.height = H; }
    if (CC.caption) CC.caption.fit();
  }
  addEventListener('resize', fit);
  // centre of an element in stage space, and in another element's local (padding-box) space
  const stagePt = (el) => { const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(); return [(r.left + r.width / 2 - sr.left) / st.s, (r.top + r.height / 2 - sr.top) / st.s]; };
  const localPt = (el, parent) => { const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect(); return [(r.left + r.width / 2 - pr.left) / st.s - parent.clientLeft, (r.top + r.height / 2 - pr.top) / st.s - parent.clientTop]; };

  // ------------------------------------------------------------------ timing
  const speed = () => (st.turbo ? 0.45 : st.skip ? 0.3 : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms * speed())));
  const anim = (el, kf, o) => { const a = el.animate(kf, { fill: 'none', ...o, duration: (o.duration || 300) * speed() }); return a.finished.catch(() => {}); };

  // ------------------------------------------------------------------ readouts (never blank, win only ever adds within a round)
  function setWin(cents, animate = true, ms = 450) {
    cents = Math.max(cents, st.winTarget); st.winTarget = cents; const w = $('win'); w.dataset.c = cents;
    const from = st.winShown, tok = (setWin.tok = (setWin.tok || 0) + 1);
    if (!animate || cents === from) { st.winShown = cents; w.textContent = dollars(cents); return Promise.resolve(); }
    w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
    const t0 = performance.now(), dur = Math.max(1, ms * speed());
    return new Promise((res) => Tick.add((now) => {
      if (tok !== setWin.tok) { res(); return false; }
      const k = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);   // rAF timestamps can precede t0 inside the same frame: clamp so the total never dips
      st.winShown = Math.round(from + (cents - from) * e); w.textContent = dollars(st.winShown);
      if (k >= 1) { st.winShown = cents; w.textContent = dollars(cents); res(); return false; } return true;
    }));
  }
  function resetWin() { setWin.tok = (setWin.tok || 0) + 1; st.winShown = st.winTarget = 0; const w = $('win'); w.dataset.c = 0; w.textContent = dollars(0); }
  function setBal(v, animate) {
    const from = st.balShown, tok = (setBal.tok = (setBal.tok || 0) + 1), el = $('bal'); st.bal = v;
    const f = (n) => (st.live && st.mode === 'ledger' && n > 0 ? '+' : '') + dollars(n);
    if (!animate || from === v) { st.balShown = v; el.textContent = f(v); return; }
    const t0 = performance.now(), dur = 600 * speed();
    Tick.add((now) => { if (tok !== setBal.tok) return false; const k = Math.max(0, Math.min(1, (now - t0) / dur)); st.balShown = Math.round(from + (v - from) * (1 - Math.pow(1 - k, 3))); el.textContent = f(st.balShown); return k < 1; });
  }
  function drawBet() {
    $('bet').textContent = dollars(bet()); $('betDn').disabled = st.busy || st.betIdx === 0; $('betUp').disabled = st.busy || st.betIdx === st.bets.length - 1;
    $('buy').disabled = st.busy; $('buyFrom').textContent = 'from ' + dollars(Math.min(costT('rotary'), costT('quote')) * bet() / 10);
  }
  function setBusy(b) { st.busy = b; $('spin').classList.toggle('run', b); $('spin').classList.toggle('idle', !b); drawBet(); }
  function toast(t, ms = 1800) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; stage.appendChild(d); setTimeout(() => d.remove(), ms); }
  function floatAt(x, y, html, cls, parent) {
    const f = document.createElement('div'); f.className = 'float ' + (cls || ''); f.innerHTML = html; f.style.left = x + 'px'; f.style.top = y + 'px'; (parent || floatsEl).appendChild(f);
    anim(f, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-80%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-140%) scale(1)', opacity: 0 }], { duration: 1100, easing: 'ease-out' }).then(() => f.remove());
  }
  function stamp(text, sub, ms = 1500, parent, cls) {
    const d = document.createElement('div'); d.className = 'stamp' + (cls ? ' ' + cls : ''); d.appendChild(document.createTextNode(text));
    if (sub) { const i = document.createElement('i'); i.textContent = sub; d.appendChild(i); }
    (parent || board).appendChild(d);
    anim(d, [{ transform: 'translate(-50%,-50%) scale(2) rotate(-8deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.95) rotate(-4deg)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-60%) scale(1) rotate(-4deg)', opacity: 0 }], { duration: ms, easing: 'ease-out' }).then(() => d.remove());
  }
  const say = (g, t) => CC.caption.say(g, t);

  // ------------------------------------------------------------------ reels
  const reels = [];
  const symNode = (sym) => { const c = document.createElement('div'); c.className = 'cell'; c.dataset.s = sym; c.appendChild(CC.assets.img(sym, 'sym')); return c; };
  function buildBoard() {
    const slots = $('slots'); slots.replaceChildren(); for (let i = 0; i < COLS * ROWS; i++) slots.appendChild(document.createElement('i'));
    reelsEl.replaceChildren(); reels.length = 0;
    for (let c = 0; c < COLS; c++) {
      const reel = document.createElement('div'); reel.className = 'reel'; reel.style.gridColumn = c + 1;
      const strip = document.createElement('div'); strip.className = 'strip'; reel.appendChild(strip); reelsEl.appendChild(reel); reels.push({ reel, strip });
    }
  }
  const cellEl = (c, r) => reels[c].strip.children[r];
  function showGrid(grid) { st.grid = grid; for (let c = 0; c < COLS; c++) { const s = reels[c].strip; s.getAnimations().forEach((a) => a.cancel()); s.replaceChildren(...grid[c].map(symNode)); s.style.transform = ''; } }
  function idleGrid() {                                        // decorative start grid: plain symbols only (no phone, quote or wild)
    const g = []; for (let c = 0; c < COLS; c++) { const col = []; for (let r = 0; r < ROWS; r++) col.push(pick(REG)); g.push(col); } showGrid(g);
  }
  function clearHits() { for (let c = 0; c < COLS; c++) for (const el of reels[c].strip.children) el.classList.remove('hit', 'dim', 'pulse'); }
  // Spin the reels onto `grid` (5 columns of 3 symbol ids). opts.tease: reel 5 spins long. Resolves when the last reel has landed.
  async function spinGrid(grid, opts = {}) {
    const prev = st.grid; let teased = false;
    const landings = grid.map((col, c) => new Promise((res) => {
      const { strip, reel } = reels[c], dur = (520 + c * 170 + (opts.tease && c === COLS - 1 ? 1300 : 0)) * speed();
      const k = Math.max(4, Math.round(dur / 85)), nodes = [...col.map(symNode)];
      for (let i = 0; i < k; i++) nodes.push(symNode(pick(REG)));
      const old = prev ? prev[c] : col; nodes.push(...old.map(symNode));
      strip.replaceChildren(...nodes);
      const dist = (nodes.length - ROWS) * PITCH;
      if (opts.tease && c === COLS - 1 && !teased) { teased = true; setTimeout(() => { reel.classList.add('tease'); SFX_.tease(); say('tease'); }, 380 * speed()); }
      const a = strip.animate([{ transform: `translateY(${-dist}px)` }, { transform: 'translateY(8px)', offset: 0.9 }, { transform: 'translateY(0)' }], { duration: dur, easing: 'cubic-bezier(.3,.6,.35,1)' });
      a.finished.then(() => {
        strip.replaceChildren(...col.map(symNode)); strip.style.transform = ''; reel.classList.remove('tease');
        const heavy = col.includes('phone') || col.includes('quote');
        SFX_.land(heavy); if (heavy) SFX_.thunk();
        if (col.includes('phone')) { SFX_.phone(c); for (let r = 0; r < ROWS; r++) if (col[r] === 'phone') cellEl(c, r).classList.add('pulse'); }
        res();
      }, res);
    }));
    await Promise.all(landings); st.grid = grid;
  }
  // Highlight winning ways, float each amount, count the total up. mult multiplies each way (free spins). Resolves with tenths shown.
  async function presentWins(wins, mult, ctx) {
    if (!wins || !wins.length) return 0;
    const hit = new Set(); let shown = 0;
    for (const w of wins) for (let c = 0; c < w.len; c++) for (const r of w.rows[c]) hit.add(c + ',' + r);
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const el = cellEl(c, r); if (el) el.classList.add(hit.has(c + ',' + r) ? 'hit' : 'dim'); }
    SFX_.chime(wins.length > 1 ? 2 : 0);
    for (const w of wins) {
      let sx = 0, sy = 0, n = 0; for (let c = 0; c < w.len; c++) for (const r of w.rows[c]) { const [x, y] = localPt(cellEl(c, r), board); sx += x; sy += y; n++; }
      const t = w.win * (mult || 1); shown += t;
      floatAt(Math.min(430, Math.max(90, sx / n)), sy / n, `<span>+${dollars(t * ctx.bet / 10)}</span>${mult > 1 ? `<b>x${mult}</b>` : ''}`);
    }
    return shown;
  }

  // ------------------------------------------------------------------ modals / tap waits
  function modal(html, o = {}) {
    return new Promise((res) => {
      const sc = document.createElement('div'); sc.className = 'scrim'; sc.innerHTML = html; ov.appendChild(sc); st.modal++;
      const done = (v) => { if (!sc.isConnected) return; sc.remove(); st.modal--; res(v); };
      sc.addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) { SFX_.click(); done(t.dataset.v); } else if (o.anywhere || (o.backdrop && e.target === sc)) done('x'); });
      sc._done = done;
    });
  }
  const waitTap = (ms) => new Promise((res) => { const t0 = st.tap, s0 = performance.now(); const iv = setInterval(() => { if (st.tap !== t0 || performance.now() - s0 > ms || (st.auto && performance.now() - s0 > 1800)) { clearInterval(iv); res(); } }, 40); });

  // ------------------------------------------------------------------ big-win overlay: builds into #ov, removes everything on close
  async function bigWin(totalX, amtCents, tier) {
    const lvl = TIER_LVL[tier]; if (!lvl) return;
    const bg = document.createElement('div'); bg.id = 'tierbg'; const box = document.createElement('div'); box.id = 'tier';
    box.innerHTML = `<div class="name"></div><div class="xx"></div><div class="amt">$0.00</div><div class="tap">TAP TO CONTINUE</div>`;
    box.querySelector('.name').textContent = TIER_NAME[tier]; box.querySelector('.xx').textContent = 'x' + (totalX >= 100 ? Math.round(totalX) : totalX.toFixed(1).replace(/\.0$/, ''));
    ov.append(bg, box); stage.classList.add('bw');
    const a = box.querySelector('.amt'); SFX_.big(lvl); SFX_.duck(true); say('bigWin');
    CC.fx.flash(160, '#fff', 0.6); CC.fx.ring(270, 430, { n: 3, r1: 220 }); CC.fx.coins(30 + lvl * 25); CC.fx.confetti(20 + lvl * 15); CC.fx.shake(6 + lvl * 3, 500);
    const D = Math.min(7000, 1800 + lvl * 1200) * speed(), t0 = performance.now(), tap0 = st.tap;
    let tk = 0; const iv = setInterval(() => SFX_.tick(tk++), 55);
    const skipped = await new Promise((res) => Tick.add((now) => {
      const sk = st.tap !== tap0 && now - t0 > 300, k = sk ? 1 : Math.max(0, Math.min(1, (now - t0) / D)), e = k < 0.85 ? (k / 0.85) * 0.8 : 0.8 + 0.2 * (1 - Math.pow(1 - (k - 0.85) / 0.15, 3));
      a.textContent = dollars(amtCents * (k >= 1 ? 1 : e)); if (k >= 1) { res(sk); return false; } return true;
    }));
    clearInterval(iv); SFX_.coin(); CC.fx.burst(270, 430, { n: 30, speed: 420, size: 9 }); CC.fx.coins(20);
    await waitTap(skipped ? 700 : 1800);
    box.style.transition = bg.style.transition = 'opacity .3s'; box.style.opacity = bg.style.opacity = 0; await new Promise((r) => setTimeout(r, 320));
    box.remove(); bg.remove(); stage.classList.remove('bw'); CC.fx.clear(); SFX_.duck(false);   // nothing of the overlay survives
  }

  // ------------------------------------------------------------------ the round
  function makeCtx(p, b, kind) {
    const run = { t: 0, total: p.totalWinTenths };
    const ctx = {
      bet: b, kind, E, st, run, p, script: p.script, dollars, boxFmt, wait, anim, say, toast, stamp, floatAt, cellEl, stagePt, localPt, stage, board, sceneEl, ov, SFX: SFX_, FX: CC.fx, modal, waitTap, setWin, spinGrid, presentWins, clearHits, reduce,
      cents: (t) => t * b / 10,
      bonusOn() { stage.classList.add('bonus'); SFX_.music('bonus'); }, bonusOff() { stage.classList.remove('bonus'); SFX_.music('base'); },
      rib(l, r) { $('ribL').textContent = l; $('ribR').textContent = r == null ? '' : r; },
      // add tenths to the running total (never decreases, never exceeds the server's round total)
      addWin(t, ms) { const add = Math.max(0, Math.min(t, run.total - run.t)); run.t += add; return setWin(run.t * b / 10, true, ms || 450); },
      willBig: E.winTier(p.totalWinTenths / 10) in TIER_LVL, isLast: true
    };
    return ctx;
  }
  async function animateRound(p, b, kind) {
    const S = p.script, ctx = makeCtx(p, b, kind);
    if (S.base) {
      ctx.rib('SPINNING', ''); await spinGrid(S.base.grid, { tease: S.base.tease }); ctx.rib(RIB_IDLE, 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x');
      if (S.base.winTenths > 0) {
        const shown = await presentWins(S.base.wins, 1, ctx); await ctx.addWin(S.base.winTenths, 500);
        await wait(Math.max(500, Math.min(1100, shown * 0.4 + 450))); clearHits();
      } else if (S.base.tease || S.base.phones.length === 2) { say('tease'); await wait(300); }
    } else { say('buy'); SFX_.sting(); await wait(500); }
    const fs = S.features || [];
    for (let i = 0; i < fs.length; i++) {
      ctx.isLast = i === fs.length - 1;
      if (fs[i].kind === 'quote') await CC.quote.run(fs[i], S.base, ctx); else await CC.rotary.run(fs[i], ctx);
    }
    if (ctx.run.t !== ctx.run.total) { dbg.mismatch.push({ round: p.roundId, shown: ctx.run.t, server: ctx.run.total }); await ctx.addWin(ctx.run.total - ctx.run.t, 400); }
    ctx.rib(RIB_IDLE, 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x');
    return ctx;
  }
  const RIB_IDLE = '3+ in a row, left to right';
  function sweep() {                                           // end-of-round cleanup: nothing created for a round may outlive it
    ov.querySelectorAll('.scrim,#tier,#tierbg,.fly,.banner').forEach((n) => n.remove()); stage.querySelectorAll('.toast.keep').forEach((n) => n.remove());
    floatsEl.replaceChildren(); board.querySelectorAll('.stamp').forEach((n) => n.remove()); sceneEl.replaceChildren();
    stage.classList.remove('bonus', 'bw'); CC.fx.clear(); SFX_.duck(false); clearHits(); st.modal = ov.querySelectorAll('.scrim').length;
  }
  let autoT = 0;
  async function play(kind) {
    if (st.busy) { if (kind === 'spin') { st.skip = true; st.tap++; } return; }
    if (st.modal) return;
    const b = bet(), cost = costT(kind) * b / 10;
    if (avail() < cost) { toast(kind === 'spin' ? 'Not enough funds. Lower your bet.' : 'Not enough funds for that bonus.'); st.auto = false; $('auto').classList.remove('on'); return; }
    SFX_.init(); wake(); dbg.started = (dbg.started || 0) + 1; setBusy(true); st.skip = false; sweep(); resetWin(); setBal(st.bal - cost, true); SFX_.spin(); say(kind === 'spin' ? 'spin' : 'buy');
    clearHits();
    let p;
    try { p = await T.spin(b, st.mode, kind === 'spin' ? null : kind); }
    catch (e) { setBal(st.live ? walletBal() : st.pracBal, true); setBusy(false); if (e.server) { toast(e.message || 'Spin refused.', 2400); st.auto = false; $('auto').classList.remove('on'); } else toast('No answer from the server.', 2400); return; }
    dbg.rounds.push({ id: p.roundId, kind, forced: p.forced || null, features: (p.script.features || []).map((f) => f.kind), win: p.totalWinTenths });
    let ctx = null;
    try { ctx = await animateRound(p, b, kind); }
    catch (e) { console.error(e); dbg.error = String(e && e.stack || e); }
    // finish: whatever happened above, show the exact server total and balance, then clean up
    try {
      if (ctx && ctx.run.t !== ctx.run.total) await ctx.addWin(ctx.run.total - ctx.run.t, 200);
      if (!ctx) { st.winTarget = 0; await setWin(p.totalWin, false); }
      const winX = p.totalWinTenths / 10, tier = E.winTier(winX), amt = p.totalWin;
      if (p.maxed) toast('MAX WIN ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x', 2200);
      if (tier in TIER_LVL) await bigWin(winX, amt, tier);
      else if (tier === 'sweet' || tier === 'nice') { stamp(tier === 'sweet' ? 'SWEET!' : 'NICE!', 'x' + (winX >= 10 ? Math.round(winX) : winX.toFixed(1).replace(/\.0$/, '')), 1300); SFX_.win(tier === 'sweet' ? 2 : 1); say(tier === 'sweet' ? 'nice' : 'smallWin'); await wait(900); }
      else if (amt > 0) { SFX_.coin(); say('smallWin'); }
      else if (Math.random() < 0.5) say('lose');
    } catch (e) { console.error(e); dbg.error = String(e && e.stack || e); }
    sweep();
    st.rounds++;
    if (st.live) { setBal(walletBal(), true); toParent({ type: 'round', win: p.totalWin, bet: b, mode: st.mode, tier: p.tier }); }
    else { st.pracBal += p.totalWin - cost; if (st.pracBal < bet()) { st.pracBal = 100000; toast('Out of practice money. Free refill.', 2200); } setBal(st.pracBal, true); }
    st.skip = false; setBusy(false); wake();
    if (st.auto) { clearTimeout(autoT); autoT = setTimeout(() => { if (st.auto && !st.busy) play('spin'); }, 450 * speed()); }
  }

  // ------------------------------------------------------------------ transports: practice (local engine), shell bridge, standalone socket
  const pend = new Map(); let reqSeq = 0;
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  const T = {
    kind: 'practice',
    spin(b, mode, buy) {
      if (!st.live) return Promise.resolve(localRound(b, buy));
      return new Promise((resolve, reject) => {
        const id = ++reqSeq, t = setTimeout(() => { pend.delete(id); reject(new Error('timeout')); }, 20000);
        pend.set(id, { ok: (x) => { clearTimeout(t); resolve(x); }, err: (e) => { clearTimeout(t); reject(e); } });
        if (BRIDGE) toParent({ type: 'spin', reqId: id, bet: b, mode: st.mode, buy });
        else T.sock.emit('g:coldcall:spin', { bet: b, mode: st.mode, ...(buy ? { buyBonus: buy } : {}), ...(QFORCE ? { force: QFORCE } : {}) });
      });
    }
  };
  function localRound(b, buy) {                                 // practice only (no wallet at stake). Same engine file, same script.
    const seed = crypto.getRandomValues(new Uint32Array(1))[0], rng = E.rngFrom(seed); let r;
    if (!buy && QFORCE === 'big') { for (let i = 0; i < 200000; i++) { r = E.resolveRound(rng, null); if (r.winX >= 25) break; } }
    else r = E.resolveRound(rng, buy, !buy && (QFORCE === 'rotary' || QFORCE === 'quote') ? { force: QFORCE } : undefined);
    return { roundId: 'p' + seed.toString(16), script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, cost: E.cents(r.costTenths, b), totalWin: E.cents(r.winTenths, b), tier: r.tier, maxed: r.capped, forced: QFORCE || undefined };
  }
  function settle(m) {                                          // a server result (bridge message or socket event) for the in-flight request
    const w = pend.values().next().value; const id = pend.keys().next().value; if (!w) return; pend.delete(id);
    if (m.error) return w.err(Object.assign(new Error(m.error), { server: true }));
    const p = m.payload; if (!p || !p.script) return w.err(new Error('bad result'));
    if (p.wallet || p.balances) applyWallet(p.wallet || p.balances);
    w.ok(p);
  }
  function applyWallet(w) {
    if (!w) return;
    if (typeof w.play === 'number') money.wallet.play = w.play;
    if (typeof w.ledgerNet === 'number') money.wallet.ledgerNet = w.ledgerNet;
    if (typeof w.ledgerLimit === 'number') money.wallet.ledgerLimit = w.ledgerLimit;
    if (st.live && !st.busy) setBal(walletBal(), false);
  }
  function modeUi() {
    const bar = $('modebar'); if (!bar) return;
    bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', st.live && x.dataset.m === st.mode));
    $('modenote').textContent = !st.live ? 'Practice (no wallet)' : st.mode === 'ledger' ? 'Ledger $ is a friendly tally. Settle up yourselves.' : 'Pretend money.';
    $('balL').textContent = !st.live ? 'PRACTICE' : st.mode === 'ledger' ? 'NET' : 'BALANCE';
    $('fine').textContent = !st.live ? 'Practice (no wallet). Free play only.' : 'No deposits, no payouts. Ledger $ is a friendly tally.';
  }
  function goLive(m) {
    if (m.state) st.server = m.state;
    if (!st.live) { st.live = true; T.kind = BRIDGE ? 'bridge' : 'socket'; setBets(Array.isArray(m.bets) && m.bets.length ? m.bets : DEFAULT_BETS); }
    if (m.mode === 'play' || m.mode === 'ledger') st.mode = m.mode;
    applyWallet(m.wallet || m.balances); modeUi(); if (!st.busy) setBal(walletBal(), false); drawBet();
  }
  function goPractice(msg) { st.live = false; T.kind = 'practice'; pend.clear(); setBets(DEFAULT_BETS); setBal(st.pracBal, false); modeUi(); drawBet(); if (msg) toast(msg, 2400); }
  function setBets(list) { st.bets = list.slice(); const i = st.bets.indexOf(100); st.betIdx = i >= 0 ? i : Math.min(3, st.bets.length - 1); }
  function initTransport() {
    const bar = document.createElement('div'); bar.id = 'modebar';
    bar.innerHTML = '<div class="mb"><button data-m="play">Play $</button><button data-m="ledger">Ledger $</button></div><span id="modenote"></span>'; stage.appendChild(bar);
    bar.addEventListener('click', (e) => { const x = e.target.closest('button'); if (!x || !st.live || st.busy) return; st.mode = x.dataset.m; SFX_.click(); setBal(walletBal(), false); modeUi(); toParent({ type: 'mode', mode: st.mode }); });
    modeUi();
    if (BRIDGE) {
      addEventListener('message', (ev) => {
        if (ev.source !== window.parent) return; const m = ev.data || {};
        if (m.type === 'init') goLive(m); else if (m.type === 'wallet') { if (st.live) applyWallet(m.wallet || m); else goLive(m); }
        else if (m.type === 'result') settle({ payload: m.payload }); else if (m.type === 'error') settle({ error: m.message || 'Spin refused.' });
      });
      addEventListener('keydown', (e) => { if (e.key === 'Escape') toParent({ type: 'esc' }); });
      toParent({ type: 'hello' }); setTimeout(() => { if (!st.live) toParent({ type: 'practice' }); }, 2000);
    } else if (LIVE_SOCKET) {
      const name = Q.get('name') || 'ccdev', pin = Q.get('pin') || '4321', s = document.createElement('script'); s.src = '/socket.io/socket.io.js';
      s.onload = () => {
        const sock = (T.sock = io()); let triedSignup = false;
        sock.on('connect', () => sock.emit('auth_login', { name, pin }));
        sock.on('auth_error', () => { if (!triedSignup) { triedSignup = true; sock.emit('auth_signup', { name, pin, avatar: 'a01' }); } });
        sock.on('auth_ok', () => sock.emit('g:coldcall:state', {}));
        sock.on('g:coldcall:state', (s2) => goLive({ wallet: s2.wallet, bets: s2.bets, state: s2, mode: 'play' }));
        sock.on('wallet', (w) => applyWallet(w));
        sock.on('g:coldcall:result', (p) => settle({ payload: p }));
        sock.on('error', (e) => { if (pend.size) settle({ error: (e && e.message) || 'Spin refused.' }); });
      };
      document.head.appendChild(s);
    }
  }

  // ------------------------------------------------------------------ calm (pause looping CSS animations when idle / hidden / docked)
  let calmT = 0;
  function wake() { app.classList.remove('calm'); clearTimeout(calmT); calmT = setTimeout(() => { if (!st.busy && !st.modal) app.classList.add('calm'); else wake(); }, 8000); }
  const calm = () => { clearTimeout(calmT); app.classList.add('calm'); };
  document.addEventListener('visibilitychange', () => (document.hidden ? calm() : wake()));
  addEventListener('blur', calm); addEventListener('focus', wake);
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, wake, { passive: true });

  // ------------------------------------------------------------------ controls
  function tog(btn, on) { btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function bindControls() {
    $('spin').addEventListener('click', () => { SFX_.init(); st.tap++; if (st.busy) { st.skip = true; return; } play('spin'); });
    board.addEventListener('click', () => { st.tap++; if (st.busy) st.skip = true; });
    $('betDn').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.max(0, st.betIdx - 1); SFX_.click(); drawBet(); });
    $('betUp').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.min(st.bets.length - 1, st.betIdx + 1); SFX_.click(); drawBet(); });
    $('turbo').addEventListener('click', () => { st.turbo = !st.turbo; $('turbo').classList.toggle('on', st.turbo); SFX_.click(); });
    $('auto').addEventListener('click', () => { SFX_.init(); st.auto = !st.auto; $('auto').classList.toggle('on', st.auto); SFX_.click(); if (st.auto && !st.busy) play('spin'); });
    tog($('sfxBtn'), SFX_.isSfx()); tog($('musicBtn'), SFX_.isMusic());
    $('sfxBtn').addEventListener('click', () => { SFX_.init(); const on = SFX_.setSfx(!SFX_.isSfx()); tog($('sfxBtn'), on); if (on) SFX_.click(); });
    $('musicBtn').addEventListener('click', () => { SFX_.init(); const on = SFX_.setMusic(!SFX_.isMusic()); tog($('musicBtn'), on); if (on) SFX_.music(stage.classList.contains('bonus') ? 'bonus' : 'base'); });
    stage.addEventListener('click', (e) => { if (e.target.closest('#tier')) st.tap++; });
    addEventListener('keydown', (e) => {
      const sc = ov.querySelector('.scrim');
      if (e.key === 'Escape' && sc) { e.stopImmediatePropagation(); sc._done && sc._done('x'); return; }
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (sc) { sc._done && sc._done('x'); return; } SFX_.init(); st.tap++; st.busy ? (st.skip = true) : play('spin'); }
    });
    $('buy').addEventListener('click', async () => {
      if (st.busy || st.modal) return; SFX_.init(); SFX_.click();
      const b = bet(), cR = costT('rotary') * b / 10, cQ = costT('quote') * b / 10;
      let v = await modal(`<div class="card"><h2>Buy a bonus</h2><div class="buygrid">
        <button class="buyopt" id="buy_rotary" data-buy="rotary" data-v="rotary" ${avail() < cR ? 'disabled' : ''}><b>ROTARY</b><span>Spin the dial for free spins and a multiplier.</span><em>${dollars(cR)}</em></button>
        <button class="buyopt" id="buy_quote" data-buy="quote" data-v="quote" ${avail() < cQ ? 'disabled' : ''}><b>QUOTE ACCEPTED</b><span>Bubbles drop into the checkout form. Fill fields to win.</span><em>${dollars(cQ)}</em></button>
      </div><button class="btn alt" data-v="x">Not now</button></div>`, { backdrop: true });
      if (v !== 'rotary' && v !== 'quote') return;
      const c = v === 'rotary' ? cR : cQ;
      const ok = await modal(`<div class="card"><h2>Confirm</h2><p>Buy <b>${v === 'rotary' ? 'ROTARY' : 'QUOTE ACCEPTED'}</b> for <b>${dollars(c)}</b>?<br><small>The price is charged now and the bonus plays straight away.</small></p><button class="btn" id="buy_confirm" data-v="yes">Confirm</button><button class="btn alt" data-v="x">Cancel</button></div>`, { backdrop: true });
      if (ok === 'yes') play(v);
    });
    $('info').addEventListener('click', async () => {
      if (st.busy || st.modal) return; SFX_.init(); SFX_.click();
      const P = E.CFG.pay, f = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(1).replace(/\.0$/, ''));
      const rows = REG.map((s) => `<div><img src="${CC.assets.symUrl(s)}" alt=""><span>${NAMES[s]}</span><small>3: ${f(P[s][0] / 10)}x<br>4: ${f(P[s][1] / 10)}x<br>5: ${f(P[s][2] / 10)}x</small></div>`).join('');
      await modal(`<div class="card"><h2>How it plays</h2>
        <p>243 ways. Matching symbols on neighbouring reels, left to right from reel 1, win. Prices are per way, in x bet.</p><div class="pay">${rows}</div>
        <p><b>The Closer</b> is wild on reels 2, 3 and 4.<br><b>ROTARY:</b> a phone on reels 1, 3 and 5. Spin the dial twice: free spins, then a multiplier. A phone in free spins is a callback: +1 spin.<br>
        <b>QUOTE ACCEPTED:</b> 6 or more quote bubbles drop into a checkout form. 3 respins, reset on each landing. Fill CVV, EXPIRY, NAME or CARD for a prize; all four = PAYMENT ACCEPTED. An UPSELL doubles its field.</p>
        <p><small>Max win ${E.MAX_WIN_X.toLocaleString('en-US')}x. ${st.server && st.server.rtp ? 'RTP ' + st.server.rtp + '.' : ''} Play money only: no deposits, no payouts.<br>Placeholder art: Twemoji, CC-BY 4.0 (Twitter, Inc. and contributors).</small></p>
        <button class="btn" data-v="x">Close</button></div>`, { backdrop: true });
    });
  }

  // ------------------------------------------------------------------ boot (called by boot.js)
  async function boot() {
    fit(); buildBoard(); initTransport(); bindControls(); drawBet();
    $('bal').textContent = dollars(st.bal); setBal(st.pracBal, false); modeUi();
    const go = $('go'), splash = $('splash');
    await CC.assets.load((d, n) => { go.textContent = 'Loading ' + d + '/' + n; });
    $('bgslot').style.backgroundImage = `url("${CC.assets.bgUrl()}")`;
    const hero = $('hero'); hero.src = CC.assets.heroUrl(); try { await hero.decode(); } catch (e) { /* shown anyway */ }
    idleGrid(); $('ribR').textContent = 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x';
    CC.caption.say('idle'); drawBet();
    const start = () => { SFX_.init(); splash.classList.add('out'); SFX_.music('base'); setTimeout(() => splash.remove(), 600); wake(); };
    go.disabled = false; go.textContent = 'Pick up';
    if (Q.has('nosplash')) splash.remove(); else go.addEventListener('click', start);
    addEventListener('pointerdown', () => SFX_.init(), { once: true });
    setInterval(() => { if (!st.busy && !st.modal && !splash.isConnected) CC.caption.say('idle'); }, 9000);
    if (Q.get('buy') === 'rotary' || Q.get('buy') === 'quote') setTimeout(() => play(Q.get('buy')), 600);
    wake();
    CC.ready = true;
  }
  CC.core = { boot, st, play, dollars, boxFmt, wait, anim, say, toast, stamp, floatAt, cellEl, stagePt, localPt, spinGrid, presentWins, clearHits, modal, waitTap, setWin, bigWin, sweep, Tick, T, money, applyWallet, goLive, goPractice, symNode, reels, REG, NAMES, E, stage, board, sceneEl };
})();
