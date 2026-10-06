/* COLD CALL: UI controller. The server resolves a whole round and returns a script; this file only ANIMATES it. The 6x5 board and cascades live in
   board.js, the phone feature in phone.js, the three bonuses in bonus.js; they talk to this file through CC.core (see the export at the end).
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
  const QFORCE = E.FORCES.includes(Q.get('force')) ? Q.get('force') : null;   // practice/QA only; the server ignores it unless COLDCALL_TEST=1
  const NAMES = { mug: 'Mug', note: 'Sticky note', ball: 'Stress ball', can: 'Energy can', cups: 'Paper cups', headset: 'Headset', rx: 'Rx bottle', pile: 'Pile', cashwad: 'Cash wad', cash: 'Cash' };
  const BUY_INFO = { call: ['THE CALL', 'One spin with a rotary phone guaranteed on the board.'], bonus1: ['DIALING FOR DOLLARS', 'Straight into 8 free spins. Hot leads stay lit until a phone calls them.'], bonus2: ['ALWAYS BE CLOSING', 'Straight into 12 free spins. Hot leads stay lit the whole bonus.'], hunt: ['BELL HUNT', 'One spin with about 5x the chance of ringing in a bonus.'] };
  const TIER_NAME = { big: 'BIG WIN', huge: 'HUGE WIN', mega: 'MEGA WIN', legend: 'LEGENDARY' };
  const TIER_LVL = { big: 1, huge: 2, mega: 3, legend: 4 };

  const stage = $('stage'), app = $('app'), board = $('board'), floatsEl = $('floats'), ov = $('ov'), sceneEl = $('scene');

  // ------------------------------------------------------------------ state
  const st = { bets: DEFAULT_BETS.slice(), betIdx: 3, busy: false, auto: false, turbo: false, skip: false, tap: 0, mode: 'play', live: false, s: 1,
    bal: 100000, balShown: 100000, winShown: 0, winTarget: 0, modal: 0, pracBal: 100000, server: null, rounds: 0, dead: 0 };
  const RAGE_STREAK = 4;                                       // paid spins in a row with no win before the hero loses it (then the count restarts)
  const money = { wallet: { play: 0, chips: 0 } };
  const bet = () => st.bets[st.betIdx];
  const usd = (c) => { const n = Math.round(c), a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
  // every amount on screen goes through dollars(): Play $ and practice show dollars, Chips mode shows whole chips (1 chip = 1 cent), as Ballot Bender does
  const dollars = (c) => (st.live && st.mode === 'chips' ? Math.round(c).toLocaleString('en-US') : usd(c));
  // buys offered right now: ids with a price in the server state (practice: the engine config). A buy the state does not price is not shown.
  const buyPrices = () => { const src = st.live ? (st.server && st.server.buyCostX) || {} : null; return E.BUYS.filter((id) => (src ? typeof src[id] === 'number' : typeof E.CFG.buyCost[id] === 'number')).map((id) => [id, src ? Math.round(src[id] * 10) : E.CFG.buyCost[id]]); };
  const costT = (kind) => { if (kind === 'spin') return 10; const f = buyPrices().find(([id]) => id === kind); return f ? f[1] : Infinity; };
  const walletBal = () => (st.mode === 'chips' ? money.wallet.chips : money.wallet.play);
  const avail = () => (st.live ? walletBal() : st.pracBal);
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
  const speed = () => (st.turbo ? 0.45 : st.skip ? 0.3 : 1) * (st.pace || 1);          // st.pace: free spins run 20% quicker so a 12-spin bonus does not drag
  const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms * speed())));
  const anim = (el, kf, o) => { const a = el.animate(kf, { fill: 'none', ...o, duration: (o.duration || 300) * speed(), delay: (o.delay || 0) * speed() }); return a.finished.catch(() => {}); };
  // number tween on the shared ticker: fn(value) every frame, resolves at the end (a tap skips it)
  const tween = (from, to, ms, fn) => { const t0 = performance.now(), dur = Math.max(1, ms * speed()); return new Promise((res) => Tick.add((now) => { const k = st.skip ? 1 : Math.max(0, Math.min(1, (now - t0) / dur)); fn(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k >= 1) { res(); return false; } return true; })); };

  // ------------------------------------------------------------------ readouts (never blank, win only ever adds within a round)
  function setWin(cents, animate = true, ms = 450) {
    cents = Math.max(cents, st.winTarget); st.winTarget = cents; const w = $('win'); w.dataset.c = cents;
    const from = st.winShown, tok = (setWin.tok = (setWin.tok || 0) + 1);
    if (!animate || cents === from) { st.winShown = cents; w.textContent = dollars(cents); return Promise.resolve(); }
    w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
    const t0 = performance.now(), dur = Math.max(1, ms * speed());
    return new Promise((res) => Tick.add((now) => {
      if (tok !== setWin.tok) { res(); return false; }
      const k = st.skip ? 1 : Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);   // a tap skips the count-up; rAF timestamps can precede t0 inside the same frame: clamp so the total never dips
      st.winShown = Math.round(from + (cents - from) * e); w.textContent = dollars(st.winShown);
      if (k >= 1) { st.winShown = cents; w.textContent = dollars(cents); res(); return false; } return true;
    }));
  }
  function resetWin() { setWin.tok = (setWin.tok || 0) + 1; st.winShown = st.winTarget = 0; const w = $('win'); w.dataset.c = 0; w.textContent = dollars(0); }
  function setBal(v, animate) {
    const from = st.balShown, tok = (setBal.tok = (setBal.tok || 0) + 1), el = $('bal'); st.bal = v;
    const f = (n) => dollars(n);
    if (!animate || from === v) { st.balShown = v; el.textContent = f(v); return; }
    const t0 = performance.now(), dur = 600 * speed();
    Tick.add((now) => { if (tok !== setBal.tok) return false; const k = Math.max(0, Math.min(1, (now - t0) / dur)); st.balShown = Math.round(from + (v - from) * (1 - Math.pow(1 - k, 3))); el.textContent = f(st.balShown); return k < 1; });
  }
  function drawBet() {
    $('bet').textContent = dollars(bet()); $('betDn').disabled = st.busy || st.betIdx === 0; $('betUp').disabled = st.busy || st.betIdx === st.bets.length - 1;
    const bp = buyPrices(); $('buy').disabled = st.busy || !bp.length; $('buyFrom').textContent = bp.length ? 'from ' + dollars(Math.min(...bp.map((x) => x[1])) * bet() / 10) : 'n/a';
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

  // ------------------------------------------------------------------ one spin (base or free): the grid drops in, the cascade replays, then the phone feature
  async function playSpin(ctx, spin, o = {}) {
    const Bd = CC.board;
    Bd.setHot(spin.hotIn, true);                               // leads carried in stay lit while the symbols drop
    if (o.bonus) SFX_.spin();
    await Bd.drop(spin.grid, { fast: o.bonus });
    for (let i = 0; i < spin.steps.length; i++) {
      if (i === 0) CC.hero.mood('hype');
      await Bd.step(spin.steps[i], i, ctx); await wait(i < spin.steps.length - 1 ? 40 : spin.phone ? 120 : 320);
    }
    if (spin.phone) await CC.phone.run(spin, ctx);
    else if (spin.steps.length && o.bonus) await wait(150);
    if (spin.hotOut.length && Bd.hotList().join() !== spin.hotOut.join()) dbg.mismatch.push({ what: 'hotOut', shown: Bd.hotList(), script: spin.hotOut });   // leads that carry on must already be lit
    Bd.setHot(spin.hotOut);                                    // base: all leads clear; bonus 1: clear if a phone fired; bonus 2 / 3: they stay
    if (spin.capped) ctx.capped = true;
  }
  async function tease(ctx) {                                  // exactly 2 bells and no bonus
    CC.board.pulse('bell'); SFX_.tease(); say('tease'); CC.hero.mood('shock'); await wait(900); CC.board.pulse('bell', false);
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
    box.innerHTML = `<div class="name"></div><div class="xx"></div><div class="amtw"><i class="cw l"></i><div class="amt">$0.00</div><i class="cw r"></i></div><div class="tap">TAP TO CONTINUE</div>`;
    box.prepend(CC.hero.img('win', 'bwh')); CC.hero.set('win', 0);
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
    box.remove(); bg.remove(); stage.classList.remove('bw'); CC.fx.clear(); SFX_.duck(false); CC.hero.set('win', 1500);   // nothing of the overlay survives
  }

  // ------------------------------------------------------------------ the round
  const MAXTXT = 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x';
  const RIB_IDLE = '5+ touching, any direction';
  function makeCtx(p, b, kind) {
    const run = { t: 0, raw: 0, total: p.totalWinTenths };
    const ctx = {
      bet: b, kind, E, st, run, p, script: p.script, dollars, wait, anim, tween, say, toast, stamp, floatAt, stagePt, localPt, stage, board, sceneEl, ov, SFX: SFX_, FX: CC.fx, modal, waitTap, setWin, reduce, capped: false,
      cents: (t) => t * b / 10,
      bonusOn() { stage.classList.add('bonus'); SFX_.music('bonus'); }, bonusOff() { stage.classList.remove('bonus'); SFX_.music('base'); },
      // ribbon: left = mode name while a bonus runs (else the first text), right = the status text
      rib(l, r) { if (ctx.modeName) { $('ribL').textContent = ctx.modeName; $('ribR').textContent = l === ctx.modeName ? (r || '') : l + (r ? ' ' + r : ''); } else { $('ribL').textContent = l; $('ribR').textContent = r == null ? '' : r; } },
      // add tenths to the running total (never decreases, never exceeds the server's round total); `raw` is what the script asked for, for the self-check
      addWin(t, ms) { run.raw += t; const add = Math.max(0, Math.min(t, run.total - run.t)); run.t += add; return setWin(run.t * b / 10, true, ms || 450); },
      willBig: E.winTier(p.totalWinTenths / 10) in TIER_LVL, isLast: true
    };
    ctx.playSpin = (sp, o) => playSpin(ctx, sp, o);
    return ctx;
  }
  async function animateRound(p, b, kind) {
    const S = p.script, ctx = makeCtx(p, b, kind);
    if (S.spin) {
      ctx.rib(S.buy === 'call' ? 'THE CALL' : S.buy === 'hunt' ? 'BELL HUNT' : 'DIALING', ''); await playSpin(ctx, S.spin);
      ctx.rib(RIB_IDLE, MAXTXT);
      if (S.spin.bells === 2 && !S.bonus) await tease(ctx);
    } else { say('buy'); SFX_.sting(); await wait(500); }
    if (S.bonus) { if (S.spin) CC.hero.mood('hype', 1800); await CC.bonus.run(S.bonus, ctx); }
    if (ctx.run.t !== ctx.run.total) { dbg.mismatch.push({ round: p.roundId, what: 'running total', shown: ctx.run.t, script: ctx.run.total }); await ctx.addWin(ctx.run.total - ctx.run.t, 400); }
    ctx.rib(RIB_IDLE, MAXTXT);
    return ctx;
  }
  function sweep() {                                           // end-of-round cleanup: nothing created for a round may outlive it
    ov.querySelectorAll('.scrim,#tier,#tierbg,.fly,.banner').forEach((n) => n.remove()); stage.querySelectorAll('.toast.keep').forEach((n) => n.remove());
    floatsEl.replaceChildren(); board.querySelectorAll('.stamp,.accept').forEach((n) => n.remove()); $('head').querySelectorAll('.stamp').forEach((n) => n.remove()); stage.querySelectorAll(':scope > .stamp').forEach((n) => n.remove()); sceneEl.replaceChildren(); $('bh').hidden = true;
    stage.classList.remove('bonus', 'bw'); st.pace = 1; CC.fx.clear(); SFX_.duck(false); CC.board.clean(); st.modal = ov.querySelectorAll('.scrim').length;
  }
  // the screen against the script, after every round: win readout, 30 cells, no leftovers, final grid. Anything off lands in CC.dbg.mismatch.
  function selfCheck(p, ctx) {
    dbg.checked = (dbg.checked || 0) + 1; const bad = (what, shown, script) => dbg.mismatch.push({ round: p.roundId, what, shown, script });
    const bs = CC.board.state(), S = ctx.script, capped = !!(p.maxed || S.capped || ctx.capped);
    if (!capped && ctx.run.raw !== ctx.run.total) bad('script adds', ctx.run.raw, ctx.run.total);
    if (st.winShown !== p.totalWin) bad('win readout (cents)', st.winShown, p.totalWin);
    if (p.totalWin !== ctx.cents(p.totalWinTenths)) bad('server cents', p.totalWin, ctx.cents(p.totalWinTenths));
    if (bs.cells !== 30) bad('cells', bs.cells, 30); if (bs.ovl) bad('overlay nodes', bs.ovl, 0); if (bs.hot) bad('hot squares', bs.hot, 0);
    const left = floatsEl.children.length + ov.children.length + sceneEl.children.length + stage.querySelectorAll('.stamp,.accept,.banner,.fly,.flash').length; if (left) bad('leftover nodes', left, 0);
    const last = S.bonus && S.bonus.spins.length ? S.bonus.spins[S.bonus.spins.length - 1] : S.spin; if (last) { const g = last.steps.length ? last.steps[last.steps.length - 1].grid : last.grid, dom = CC.board.domGrid(); for (let i = 0; i < 30; i++) if (dom[i] !== E.SYM[g[i]]) { bad('final grid', dom.join(), g.map((x) => E.SYM[x]).join()); break; } }
    if (CC.fx.running()) bad('fx loop running', 1, 0);
  }
  const allSpins = (S) => [...(S.spin ? [S.spin] : []), ...(S.bonus ? S.bonus.spins : [])];
  let autoT = 0;
  async function play(kind) {
    if (st.busy) { if (kind === 'spin') { st.skip = true; st.tap++; } return; }
    if (st.modal) return;
    const b = bet(), cost = costT(kind) * b / 10;
    if (avail() < cost) { toast(kind === 'spin' ? 'Not enough funds. Lower your bet.' : 'Not enough funds for that bonus.'); st.auto = false; $('auto').classList.remove('on'); return; }
    SFX_.init(); wake(); dbg.started = (dbg.started || 0) + 1; setBusy(true); st.skip = false; CC.hero.set('idle'); sweep(); resetWin(); setBal(st.bal - cost, true); SFX_.spin(); say(kind === 'spin' ? 'spin' : 'buy');
    let p;
    try { p = await T.spin(b, st.mode, kind === 'spin' ? null : kind); }
    catch (e) { setBal(st.live ? walletBal() : st.pracBal, true); setBusy(false); if (e.server) { toast(e.message || 'Spin refused.', 2400); st.auto = false; $('auto').classList.remove('on'); } else toast('No answer from the server.', 2400); return; }
    dbg.rounds.push({ id: p.roundId, kind, forced: p.forced || null, tease: !!(p.script.spin && p.script.spin.bells === 2 && !p.script.bonus), cluster: p.script.spin ? p.script.spin.cluster : 0, bigClose: allSpins(p.script).some((s) => s.phone && s.phone.rounds.some((r) => r.collects.some((c) => c.value >= 250))), bonus: p.script.bonus ? p.script.bonus.kind : null, phone: !!((p.script.spin && p.script.spin.phone) || (p.script.bonus && p.script.bonus.spins.some((s) => s.phone))), tier: p.tier, win: p.totalWinTenths });
    let ctx = null;
    try { ctx = await animateRound(p, b, kind); }
    catch (e) { console.error(e); dbg.error = String(e && e.stack || e); }
    // finish: whatever happened above, show the exact server total and balance, then clean up
    try {
      if (ctx && ctx.run.t !== ctx.run.total) await ctx.addWin(ctx.run.total - ctx.run.t, 200);
      if (!ctx) { st.winTarget = 0; await setWin(p.totalWin, false); }
      const winX = p.totalWinTenths / 10, tier = E.winTier(winX), amt = p.totalWin;
      if (p.maxed || (ctx && ctx.capped) || p.script.capped) { stamp('MAX WIN', E.MAX_WIN_X.toLocaleString('en-US') + 'x. The round stops here.', 1700, null, 'hi'); SFX_.win(3); say('bigWin'); await wait(1400); }
      if (tier in TIER_LVL) await bigWin(winX, amt, tier);
      else if (tier === 'sweet' || tier === 'nice') { stamp(tier === 'sweet' ? 'SWEET!' : 'NICE!', 'x' + (winX >= 10 ? Math.round(winX) : winX.toFixed(1).replace(/\.0$/, '')), 1300); SFX_.win(tier === 'sweet' ? 2 : 1); say(tier === 'sweet' ? 'nice' : 'smallWin'); await wait(900); }
      else if (amt > 0) { SFX_.coin(); say('smallWin'); }
      else {
        st.dead = kind === 'spin' ? st.dead + 1 : 0;
        if (st.dead >= RAGE_STREAK) { st.dead = 0; CC.hero.set('rage', 2400); say('rage'); }
        else if (Math.random() < 0.5) say('lose');
      }
      if (amt > 0) st.dead = 0;
    } catch (e) { console.error(e); dbg.error = String(e && e.stack || e); }
    sweep();
    if (ctx) selfCheck(p, ctx); else dbg.mismatch.push({ round: p.roundId, what: 'animation error', shown: dbg.error || '', script: '' });
    st.rounds++;
    if (st.live) { setBal(walletBal(), true); dbg.lastBal = { shown: st.bal, wallet: walletBal() }; toParent({ type: 'round', win: p.totalWin, bet: b, mode: st.mode, tier: p.tier }); }
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
    const seed = crypto.getRandomValues(new Uint32Array(1))[0], rng = E.rngFrom(seed);
    const r = E.resolveRound(rng, buy, !buy && QFORCE ? { force: QFORCE } : undefined);
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
    if (typeof w.chips === 'number') money.wallet.chips = w.chips;
    if (st.live && !st.busy) setBal(walletBal(), false);
  }
  function modeUi() {
    const bar = $('modebar'); if (!bar) return;
    bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', st.live && x.dataset.m === st.mode));
    $('modenote').textContent = !st.live ? 'Practice (no wallet)' : st.mode === 'chips' ? 'Real poker chips from your bank.' : 'Pretend money.';
    $('balL').textContent = !st.live ? 'PRACTICE' : st.mode === 'chips' ? 'CHIPS' : 'BALANCE';
    $('fine').textContent = !st.live ? 'Practice (no wallet). Free play only.' : 'No deposits, no payouts. Chips are your poker bank.';
  }
  function goLive(m) {
    if (m.state) st.server = m.state;
    if (!st.live) { st.live = true; T.kind = BRIDGE ? 'bridge' : 'socket'; setBets(Array.isArray(m.bets) && m.bets.length ? m.bets : DEFAULT_BETS); }
    if (m.mode === 'play' || m.mode === 'chips') st.mode = m.mode;
    applyWallet(m.wallet || m.balances); modeUi(); if (!st.busy) setBal(walletBal(), false); drawBet();
  }
  function goPractice(msg) { st.live = false; T.kind = 'practice'; pend.clear(); setBets(DEFAULT_BETS); setBal(st.pracBal, false); modeUi(); drawBet(); if (msg) toast(msg, 2400); }
  function setBets(list) { st.bets = list.slice(); const i = st.bets.indexOf(100); st.betIdx = i >= 0 ? i : Math.min(3, st.bets.length - 1); }
  function initTransport() {
    const bar = document.createElement('div'); bar.id = 'modebar';
    bar.innerHTML = '<div class="mb"><button data-m="play">Play $</button><button data-m="chips">Chips</button></div><span id="modenote"></span>'; stage.appendChild(bar);
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
    stage.addEventListener('click', (e) => { if (e.target.closest('#tier, .scn')) st.tap++; });
    addEventListener('keydown', (e) => {
      const sc = ov.querySelector('.scrim');
      if (e.key === 'Escape' && sc) { e.stopImmediatePropagation(); sc._done && sc._done('x'); return; }
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (sc) { sc._done && sc._done('x'); return; } SFX_.init(); st.tap++; st.busy ? (st.skip = true) : play('spin'); }
    });
    $('buy').addEventListener('click', async () => {
      if (st.busy || st.modal) return; SFX_.init(); SFX_.click();
      const b = bet(), list = buyPrices(); if (!list.length) return;
      const opts = list.map(([id, t]) => { const c = t * b / 10; return `<button class="buyopt" id="buy_${id}" data-buy="${id}" data-v="${id}" ${avail() < c ? 'disabled' : ''}><b>${BUY_INFO[id][0]}</b><span>${BUY_INFO[id][1]}</span><em>${dollars(c)}</em></button>`; }).join('');
      const v = await modal(`<div class="card"><h2>Buy a bonus</h2><div class="buygrid">${opts}</div><button class="btn alt" data-v="x">Not now</button></div>`, { backdrop: true });
      const hit = list.find(([id]) => id === v); if (!hit) return;
      const c = hit[1] * b / 10;
      const ok = await modal(`<div class="card"><h2>Confirm</h2><p>Buy <b>${BUY_INFO[v][0]}</b> for <b>${dollars(c)}</b>?<br><small>The price is charged now and it plays straight away.</small></p><button class="btn" id="buy_confirm" data-v="yes">Confirm</button><button class="btn alt" data-v="x">Cancel</button></div>`, { backdrop: true });
      if (ok === 'yes') play(v);
    });
    $('info').addEventListener('click', async () => {
      if (st.busy || st.modal) return; SFX_.init(); SFX_.click();
      const C = E.CFG, x = (t) => { const n = t / 10; return n >= 100 ? String(Math.round(n)) : String(+n.toFixed(1)); };
      const head = ['5', '6', '7', '8', '9', '10', '11', '12', '13+'].map((s) => `<th>${s}</th>`).join('');
      const rows = E.SYM.slice(0, E.NREG).reverse().map((s) => `<tr><td class="sy"><img src="${CC.assets.symUrl(s)}" alt=""><span>${NAMES[s]}</span></td>${C.pay[s].map((t) => `<td>${x(t)}</td>`).join('')}</tr>`).join('');
      const range = (a) => x(a[0][0]) + 'x to ' + x(a[a.length - 1][0]) + 'x';
      await modal(`<div class="card info"><h2>How it plays</h2>
        <p><b>Clusters.</b> Land 5 or more of the same symbol touching each other (up, down, left, right) to win. <b>The Closer</b> is wild for any pay symbol.</p>
        <p><b>Cascades.</b> A win clears the cluster and every other matching symbol on the board. The rest fall, new ones drop in, and it repeats while wins keep forming.</p>
        <p><b>Hot leads.</b> Every square in a winning cluster turns into a sticky note and stays lit while symbols fall.</p>
        <p><b>The Call.</b> When the cascade ends and a <b>rotary phone</b> is on the board, every hot lead is dialed and flips to a <b>quote bubble</b> (bronze ${range(C.bubbles.bronze)}, silver ${range(C.bubbles.silver)}, gold ${range(C.bubbles.gold)}), an <b>UPSELL</b> (${C.upsell.map((u) => 'x' + u[0]).join(' ')}, multiplies the bubbles and closes next to it) or <b>THE CLOSE</b>, which collects every bubble on the board. After a close the other leads are dialed again. The bubbles and closes on the board pay.</p>
        <p><b>Bells.</b> The desk bells that landed in a spin: 3 = DIALING FOR DOLLARS (${C.spins.bonus1} free spins, leads stay lit until a phone calls them), 4 = ALWAYS BE CLOSING (${C.spins.bonus2} free spins, leads stay lit the whole bonus), 5 or more = QUOTE ACCEPTED (${C.spins.bonus3} free spins, a phone on every spin, no bronze bubbles). In a bonus 2 bells add 2 spins, 3 add 4; 4 or more in DIALING FOR DOLLARS upgrades it to ALWAYS BE CLOSING. Up to ${C.maxSpins} spins.</p>
        <p class="tl">Pay for a cluster, x bet</p><div class="pt"><table><tr><th></th>${head}</tr>${rows}</table></div>
        <p><small>Max win ${E.MAX_WIN_X.toLocaleString('en-US')}x. ${st.server && st.server.rtp ? 'RTP ' + st.server.rtp + '.' : ''} Play money only: no deposits, no payouts.</small></p>
        <button class="btn" data-v="x">Close</button></div>`, { backdrop: true });
    });
  }

  // ------------------------------------------------------------------ boot (called by boot.js)
  async function boot() {
    fit(); CC.board.build(); initTransport(); bindControls(); drawBet();
    $('bal').textContent = dollars(st.bal); setBal(st.pracBal, false); modeUi();
    const go = $('go'), splash = $('splash');
    await CC.assets.load((d, n) => { go.textContent = 'Loading ' + d + '/' + n; });
    const hero = $('hero'); hero.src = CC.assets.heroUrl(); try { await hero.decode(); } catch (e) { /* shown anyway */ }
    $('splashHero').src = CC.assets.heroUrl();
    if (Q.has('shot') || Q.has('mock')) { const qs = document.createElement('script'); qs.src = 'qa.js'; document.head.appendChild(qs); }   // QA shot flag: see qa.js
    CC.board.idle(); $('ribR').textContent = 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x';
    CC.caption.say('idle'); drawBet();
    const start = () => { SFX_.init(); splash.classList.add('out'); SFX_.music('base'); setTimeout(() => splash.remove(), 600); wake(); };
    go.disabled = false; go.textContent = 'Pick up';
    if (Q.has('nosplash')) splash.remove(); else go.addEventListener('click', start);
    addEventListener('pointerdown', () => SFX_.init(), { once: true });
    setInterval(() => { if (!st.busy && !st.modal && !splash.isConnected) CC.caption.say('idle'); }, 9000);
    if (E.BUYS.includes(Q.get('buy'))) setTimeout(() => play(Q.get('buy')), 600);
    wake();
    CC.ready = true;
  }
  CC.core = { boot, st, play, dollars, wait, anim, tween, speed, say, toast, stamp, floatAt, stagePt, localPt, modal, waitTap, setWin, bigWin, sweep, Tick, T, money, applyWallet, goLive, goPractice, E, stage, board, sceneEl, SFX: SFX_, FX: CC.fx };
})();
