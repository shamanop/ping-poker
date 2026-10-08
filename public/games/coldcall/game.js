/* COLD CALL: UI controller. The server resolves a whole round and returns a script; this file only ANIMATES it. The 6x5 board and cascades live in
   board.js, the phone feature in phone.js, the three bonuses in bonus.js; they talk to this file through CC.core (see the export at the end).
   Money: integer cents everywhere. A script amount is in tenths; its cents are t * pay.num / pay.den (a spin: bet / 10; a buy: price / cost multiple, so a 1c buy is not 1/10 c a tenth).
   From 10c up that is exact; at 1c / 2c / 5c a tenth can be a fraction of a cent: steps and the running WIN show it (sub-cent as a multiple / "<1c"), the server's whole cents are the truth
   (totalWin, pay, bankCents / winCents / baseCents) and the meter lands on them. Live math (prices, pay table, rules, RTP label) is the server's (state / g:coldcall:cfg), never the engine copy. */
(() => {
  const CC = (window.CC = window.CC || {});
  const $ = (id) => document.getElementById(id);
  const E = ColdCallEngine, COLS = E.COLS, ROWS = E.ROWS;
  const Q = new URLSearchParams(location.search);
  const SFX_ = SFX;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BRIDGE = Q.get('bridge') === '1' && window.parent !== window;
  const LIVE_SOCKET = !BRIDGE && Q.get('live') === '1';
  const DEFAULT_BETS = E.BET_LEVELS.filter((b) => b >= 10);   // practice (local engine, no wallet) plays the 10c-and-up ladder; the 1c / 2c / 5c bets need the server's whole-cent rounding
  const QFORCE = E.FORCES.includes(Q.get('force')) ? Q.get('force') : null;   // practice/QA only; the server ignores it unless COLDCALL_TEST=1
  const NAMES = { mug: 'Mug', note: 'Sticky note', ball: 'Stress ball', can: 'Energy can', cups: 'Paper cups', headset: 'Headset', rx: 'Rx bottle', pile: 'Pile', cashwad: 'Cash wad', cash: 'Cash' };
  const BUY_INFO = { call: ['THE CALL', 'One spin with a rotary phone guaranteed on the board.'], bonus1: ['DIALING FOR DOLLARS', 'Straight into %bonus1% free spins. Hot leads stay lit until a phone calls them.'], bonus2: ['ALWAYS BE CLOSING', 'Straight into %bonus2% free spins. Hot leads stay lit the whole bonus.'], hunt: ['BELL HUNT', 'One spin with about 5x the chance of ringing in a bonus.'] };
  const TIER_NAME = { big: 'BIG WIN', huge: 'HUGE WIN', mega: 'MEGA WIN', legend: 'LEGENDARY' };
  const TIER_LVL = { big: 1, huge: 2, mega: 3, legend: 4 };

  const stage = $('stage'), app = $('app'), board = $('board'), floatsEl = $('floats'), ov = $('ov'), sceneEl = $('scene');

  // ------------------------------------------------------------------ state
  const st = { bets: DEFAULT_BETS.slice(), betIdx: 3, busy: false, auto: false, turbo: false, skip: false, tap: 0, mode: 'play', live: false, s: 1,
    bal: 100000, balShown: 100000, winShown: 0, winTarget: 0, modal: 0, pracBal: 100000, server: null, rounds: 0, dead: 0,
    pv: { play: null, chips: null }, pot: { play: null, chips: null }, cbBet: null, ctx: null, me: '', feedAll: [], feedShown: new Set() };   // pv: the pull state view per mode (leads, cb, warm, warmBet, cold, daily); cbBet: bet of the Callback round on screen
  const RAGE_STREAK = 4;                                       // paid spins in a row with no win before the hero loses it (then the count restarts)
  const money = { wallet: { play: 0, chips: 0 } };
  const bet = () => st.bets[st.betIdx];
  const usd = (c) => { const n = Math.round(c), a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
  // every amount on screen goes through dollars(): Play $ and practice show dollars, Chips mode shows whole chips (1 chip = 1 cent), as Ballot Bender does
  // Chips follow the shell's money preference like Ballot Bender (9d5f578): chips by default, dollars when the player picked USD (then no ' chips' unit is added: unit())
  const chipsUsd = () => { try { const M = window.parent && window.parent !== window ? window.parent.Money : null; return !!(M && M.getPref && M.getPref() === 'usd'); } catch (e) { return false; } };
  const chipsFmt = (c) => { try { const M = window.parent && window.parent !== window ? window.parent.Money : null; if (M && M.getPref && M.getPref() === 'usd') return M.fmt(c, { mode: 'usd' }); } catch (e) { /* standalone */ } return Math.round(c).toLocaleString('en-US'); };
  const dollars = (c) => (st.live && st.mode === 'chips' ? chipsFmt(c) : usd(c));
  const unit = () => (st.live && st.mode === 'chips' && !chipsUsd() ? ' chips' : '');
  // the WIN meter / a running total: a fractional-cent round shows whole cents rounded DOWN and "<1c" under one cent (never "$0.00" for a win that is not zero); the end of the round sets the server's cents
  const meterTxt = (c) => (st.frac && c > 0 && c < 1 ? '<' + dollars(1) : dollars(st.frac ? Math.floor(c + 1e-6) : c));
  const xTxt = (x) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : String(+Number(x).toFixed(1))) + 'x';
  // bubble / close chips: short text of whole cents ("5c", "$1.20", "$12.5k"; Chips: 1,250 / 125k)
  const shortAmt = (c) => {
    if (st.live && st.mode === 'chips' && !chipsUsd()) return c < 100000 ? Math.round(c).toLocaleString('en-US') : c < 1e6 ? Math.round(c / 1000) + 'k' : String(+(c / 1e6).toFixed(1)) + 'M';
    return c < 100 ? Math.round(c) + 'c' : c < 1000000 ? '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)) : '$' + String(+(c / 100000).toFixed(1)) + 'k';
  };
  // the cents scale of a round: pay.num / pay.den (every result carries pay, a pending one too once the server sends it), else cost / costTenths for a buy, else bet / 10
  const scaleOf = (p, b) => {
    const y = p && p.pay; if (y && Number.isFinite(y.num) && y.num >= 0 && y.den > 0) return { num: y.num, den: y.den };
    if (p && p.costTenths > 0 && p.cost > 0) return { num: p.cost, den: p.costTenths };
    return { num: b, den: 10 };
  };
  // buys offered right now at the current bet: [id, price in whole cents]. Signed in: the server's buyPriceCents[bet][buy] (live, nearest-cent, at least 1c); an older server without it: the engine's
  // buyPrice from its buyCostX. Practice: the engine copy. A buy with no price is not shown.
  const buyList = (b = bet()) => {
    if (st.live) {
      const sv = st.server || {}, row = sv.buyPriceCents && sv.buyPriceCents[b], src = sv.buyCostX || {};
      return E.BUYS.filter((id) => (row ? Number.isFinite(row[id]) && row[id] > 0 : typeof src[id] === 'number')).map((id) => [id, row ? row[id] : E.buyPrice(Math.round(src[id] * 10), b)]);
    }
    return E.BUYS.filter((id) => typeof E.CFG.buyCost[id] === 'number').map((id) => [id, E.buyPrice(E.CFG.buyCost[id], b)]);
  };
  const buyDesc = (id) => { const sp = (liveCfg() && liveCfg().spins) || E.CFG.spins; return BUY_INFO[id][1].replace(/%(\w+)%/g, (m, k) => (sp[k] != null ? sp[k] : '')); };   // free-spin counts follow the live config
  const costC = (kind, b) => { if (kind === 'spin') return b; const f = buyList(b).find(([id]) => id === kind); return f ? f[1] : Infinity; };
  const walletBal = () => (st.mode === 'chips' ? money.wallet.chips : money.wallet.play);
  const avail = () => (st.live ? walletBal() : st.pracBal);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const rand = (a, b) => a + Math.random() * (b - a);
  const dbg = (CC.dbg = { mismatch: [], rounds: [], calls: 0, pull: [] });
  // builder B's look layer (CC.pull) may not exist, or may throw: every call is guarded and a failure never stops a round
  const P = (fn, ...a) => { try { const f = CC.pull && CC.pull[fn]; if (typeof f === 'function') return f.apply(CC.pull, a); } catch (e) { dbg.pull.push(fn + ': ' + (e && e.message)); } };
  const PA = async (fn, ...a) => { try { return await P(fn, ...a); } catch (e) { dbg.pull.push(fn + ': ' + (e && e.message)); } };
  const pview = () => (st.live && !(st.rules && st.rules.on === false) ? st.pv[st.mode] : null);   // a switched-off PULL has no view: no Callback, no lead list

  // ------------------------------------------------------------------ one shared rAF ticker (count-ups). The other loop is fx.js.
  const Tick = (() => { const fns = new Set(); let raf = 0; const loop = (now) => { for (const f of [...fns]) if (!f(now)) fns.delete(f); raf = fns.size ? requestAnimationFrame(loop) : 0; }; return { add(f) { fns.add(f); if (!raf) raf = requestAnimationFrame(loop); } }; })();

  // ------------------------------------------------------------------ layout
  function fit() {
    const H = Math.max(960, Math.min(1250, Math.round(540 * innerHeight / innerWidth)));
    st.s = Math.min(innerWidth / 540, innerHeight / H);
    stage.style.setProperty('--H', H + 'px'); app.style.setProperty('--s', st.s);   // --s on #app: the wide-screen side art sizes itself from it
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
  const showWin = (w, c) => { w.textContent = meterTxt(c); if (st.mirror) st.mirror(w.textContent); };   // the bonus HUD total mirrors the WIN meter itself
  function setWin(cents, animate = true, ms = 450, drop = false) {   // drop: the one place the meter may go down (ONE MORE CALL taken and lost)
    cents = drop ? cents : Math.max(cents, st.winTarget); st.winTarget = cents; const w = $('win'); w.dataset.c = cents;
    const from = st.winShown, tok = (setWin.tok = (setWin.tok || 0) + 1);
    if (!animate || cents === from) { st.winShown = cents; showWin(w, cents); return Promise.resolve(); }
    w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
    const t0 = performance.now(), dur = Math.max(1, ms * speed());
    return new Promise((res) => Tick.add((now) => {
      if (tok !== setWin.tok) { res(); return false; }
      const k = st.skip ? 1 : Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);   // a tap skips the count-up; rAF timestamps can precede t0 inside the same frame: clamp so the total never dips
      st.winShown = st.frac ? from + (cents - from) * e : Math.round(from + (cents - from) * e); showWin(w, st.winShown);
      if (k >= 1) { st.winShown = cents; showWin(w, cents); res(); return false; } return true;
    }));
  }
  function resetWin() { setWin.tok = (setWin.tok || 0) + 1; st.frac = false; st.winShown = st.winTarget = 0; const w = $('win'); w.dataset.c = 0; w.textContent = dollars(0); }
  function setBal(v, animate) {
    const from = st.balShown, tok = (setBal.tok = (setBal.tok || 0) + 1), el = $('bal'); st.bal = v;
    const f = (n) => dollars(n);
    if (!animate || from === v) { st.balShown = v; el.textContent = f(v); return; }
    const t0 = performance.now(), dur = 600 * speed();
    Tick.add((now) => { if (tok !== setBal.tok) return false; const k = Math.max(0, Math.min(1, (now - t0) / dur)); st.balShown = Math.round(from + (v - from) * (1 - Math.pow(1 - k, 3))); el.textContent = f(st.balShown); return k < 1; });
  }
  // THE CALLBACK pending (or running): the SPIN button reads CALLBACK and the bet shown is the Callback's own bet; the bet buttons do nothing then
  const cbPending = () => { const v = pview(); return st.cbBet != null || (!!v && !!v.cb); };
  const cbBetNow = () => (st.cbBet != null ? st.cbBet : (pview() || {}).cb ? pview().cb.bet : null);
  function drawBet() {
    const cb = cbPending(), sp = $('spin') && $('spin').firstElementChild;
    if (sp) { sp.textContent = cb ? 'CALLBACK' : 'SPIN'; sp.style.fontSize = cb ? '15px' : ''; }
    $('spin').classList.toggle('cb', cb);
    $('bet').textContent = dollars(cb ? cbBetNow() : bet()); $('betDn').disabled = st.busy || cb || st.betIdx === 0; $('betUp').disabled = st.busy || cb || st.betIdx === st.bets.length - 1;
    const bp = buyList(); $('buy').disabled = st.busy || !bp.length || cb; $('buyFrom').textContent = cb ? 'Callback first' : bp.length ? 'from ' + dollars(Math.min(...bp.map((x) => x[1]))) : 'n/a';   // U15: buy prices follow the bet, a Callback shows its own and freezes it: no buying until it is played
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
  // o.hold: a PICK decision spin (spin.pickPending): the drop and the cascades only, the phone waits for the player (hotOut is null, the lit squares stay).
  // o.resume: the same spin after the pick: only the phone feature runs (no drop, no steps), the board is exactly as the hold left it.
  async function playSpin(ctx, spin, o = {}) {
    const Bd = CC.board;
    if (!o.resume) {
      Bd.setHot(spin.hotIn, true);                             // leads carried in stay lit while the symbols drop
      if (o.bonus) SFX_.spin();
      await Bd.drop(spin.grid, { fast: o.bonus });
      for (let i = 0; i < spin.steps.length; i++) {
        if (i === 0) CC.hero.mood('hype');
        await Bd.step(spin.steps[i], i, ctx); await wait(i < spin.steps.length - 1 ? 40 : spin.phone ? 120 : 320);
      }
    }
    if (o.hold) { if (spin.capped) ctx.capped = true; return; }
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
      a.textContent = dollars(amtCents * (k >= 1 ? 1 : e)); $('win').textContent = a.textContent; if (k >= 1) { res(sk); return false; } return true;
    }));
    clearInterval(iv); SFX_.coin(); CC.fx.burst(270, 430, { n: 30, speed: 420, size: 9 }); CC.fx.coins(20);
    await waitTap(skipped ? 700 : 1800);
    box.style.transition = bg.style.transition = 'opacity .3s'; box.style.opacity = bg.style.opacity = 0; await new Promise((r) => setTimeout(r, 320));
    box.remove(); bg.remove(); stage.classList.remove('bw'); CC.fx.clear(); SFX_.duck(false); CC.hero.set('win', 1500);   // nothing of the overlay survives
  }

  // ------------------------------------------------------------------ the round
  const maxX = () => (st.live && st.server && Number.isFinite(st.server.maxWinX) ? st.server.maxWinX : E.MAX_WIN_X);   // the live cap (server cfg.maxWinTenths) for a signed-in player
  const maxTxt = () => 'MAX ' + maxX().toLocaleString('en-US') + 'x';
  const RIB_IDLE = '5+ touching = win';
  const DEFAULT_TXT = { pick: 'first lead picked', more: 'banked' };    // what the server does when nobody decides (timeout, disconnect, autoplay)
  const LOST_MS = 9000;                                                 // an answer the server owes us (after the timer ran out, or after a decide) must come within this
  class Abort extends Error {}                                          // the round cannot go on on this screen (voided, refused, line lost): the server settles it, the screen cleans up
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const mkTimer = () => ({ timeoutMs: 0, expiresAt: 0, at: 0, synced: false, srvExp: 0, assumed: false, left() { return Math.max(0, this.expiresAt - Date.now()); } });
  // U5: the clock follows the server's expiresAt. A repeat of the expiresAt already counted changes nothing (a second tab's `ready` answers every socket with the SAME one);
  // a new one is read against our clock when that is plausible, else moved by the server's own delta, else counted from receipt.
  function syncTimer(t, exp, ms) {
    const now = Date.now(); if (ms > 0) t.timeoutMs = ms;
    if (Number.isFinite(exp) && exp > 0) {
      if (t.srvExp === exp && !t.assumed) return false;
      const left = exp - now, was = t.srvExp; t.assumed = false;
      if (left > 0 && left <= t.timeoutMs + 2000) t.expiresAt = now + Math.min(left, t.timeoutMs);
      else if (was) t.expiresAt += exp - was;
      else t.expiresAt = now + t.timeoutMs;
      t.srvExp = exp;
    } else { t.expiresAt = now + t.timeoutMs; t.assumed = false; }
    t.at = now; t.synced = true; return true;
  }
  // U1: a decision is answered only by a tap that STARTED after the prompt opened and lands >= ARM_MS after it. SPIN / Space / board taps are never a skip while one is up.
  const ARM_MS = 600;
  const promptUp = () => !!(st.ctx && st.ctx.promptOpen);
  let lastDown = 0;
  addEventListener('pointerdown', (e) => { lastDown = e.timeStamp; }, true);
  addEventListener('click', (e) => {
    const c = st.ctx; if (!c || !c.promptOpen || !c.promptOpenedAt) return;
    if (e.timeStamp - c.promptOpenedAt < ARM_MS || (e.detail > 0 && lastDown < c.promptOpenedAt)) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  // ctx lives for the WHOLE round: every result of the round (pending, pending, done) is applied to it with advance(), the animation keeps going from where it is
  function makeCtx(p, b, kind) {
    const final = p.status !== 'pending';
    const run = { t: 0, raw: 0, total: final ? p.totalWinTenths : Infinity };   // the final total is only known on the done result
    const ctx = {
      bet: b, kind, E, st, run, p, script: p.script || p.partial, callback: !!p.callback, timer: mkTimer(), decisions: [], cur: { base: false, intro: false, spins: 0 },
      dollars, wait, anim, tween, say, toast, stamp, floatAt, stagePt, localPt, stage, board, sceneEl, ov, SFX: SFX_, FX: CC.fx, modal, waitTap, setWin, reduce, capped: false,
      cents: (t) => t * ctx.sc.num / ctx.sc.den,                                  // tenths -> cents on the round's own scale (pay.num / pay.den): bet / 10 for a spin, price / cost multiple for a buy
      // a step amount (cluster pay, bubble, close): whole cents rounded to the nearest; under half a cent in a fractional round the multiple of the bet instead (0.4x): never $0.00 for a win that is not zero
      amt(t, short) { const c = ctx.cents(t); if (ctx.frac && Math.round(c) < 1 && t > 0) return xTxt(t / 10); return short ? shortAmt(Math.round(c)) : dollars(Math.round(c)); },
      meterTxt,
      bonusOn() { stage.classList.add('bonus'); SFX_.music('bonus'); }, bonusOff() { stage.classList.remove('bonus'); SFX_.music('base'); },
      // ribbon: left = mode name while a bonus runs (else the first text), right = the status text
      rib(l, r) { if (ctx.modeName) { $('ribL').textContent = ctx.modeName; $('ribR').textContent = l === ctx.modeName ? (r || '') : l + (r ? ' ' + r : ''); } else { $('ribL').textContent = l; $('ribR').textContent = r == null ? '' : r; } },
      // add tenths to the running total (never decreases, never exceeds the server's round total); `raw` is what the script asked for, for the self-check
      addWin(t, ms) { run.raw += t; const add = Math.max(0, Math.min(t, run.total - run.t)); run.t += add; return setWin(ctx.cents(run.t), true, ms || 450); },
      willBig: final && E.winTier(p.totalWinTenths / 10) in TIER_LVL, isLast: true,
      pickTargets: (choices, cb) => CC.board.pickTargets(choices, cb)       // for the pick prompt (CC.pull.askPick): taps on the lit squares
    };
    ctx.playSpin = (sp, o) => playSpin(ctx, sp, o);
    ctx.rules = st.rules || null; ctx.sc = scaleOf(p, b); ctx.frac = ctx.sc.num % ctx.sc.den !== 0; st.frac = ctx.frac; ctx.bankCents = null;
    ctx.decide = { pick: (pend) => decisionPoint(ctx, 'pick', pend), more: (pend) => decisionPoint(ctx, 'more', pend) };
    ctx.moreOutcome = () => moreOutcome(ctx);
    advance(ctx, p);
    return ctx;
  }
  function advance(ctx, r) {                                   // a newer result of the same round: longer script, maybe the final totals
    ctx.p = r; ctx.script = r.script || r.partial || ctx.script;
    if (r.pay || r.costTenths != null) { ctx.sc = scaleOf(r, ctx.bet); ctx.frac = ctx.sc.num % ctx.sc.den !== 0; }
    if (r.status === 'pending') { const ms = r.timeoutMs || (st.server && st.server.pull && st.server.pull.decisionMs) || 20000; syncTimer(ctx.timer, r.expiresAt, ms); }
    else { ctx.run.total = r.totalWinTenths; const m = r.pull && r.pull.more; ctx.willBig = E.winTier(r.totalWinTenths / 10) in TIER_LVL && !(m && m.take && !m.won); }   // U17: a lost gamble gets no BIG WIN tier
  }

  // ---- decisions: PICK YOUR LEAD (pick) and ONE MORE CALL (more). The prompt comes from CC.pull (builder B) or the plain placeholder below.
  // Returns when the round has its next result (applied to ctx). Never decides for the player; the server's own default arrives as an unsolicited result.
  async function nextResult(ctx, box, ms) {
    for (;;) {
      const got = await Promise.race([boxWait(box), delay(ms).then(() => LOST)]);
      if (got === LOST) throw new Abort('lost');
      const it = box.q.shift(); if (!it) continue;
      if (it._voided) throw new Abort('voided'); if (it._dropped) throw new Abort('dropped');
      if (it._err) { if (it._err.code === 'no_round') continue; throw new Abort(it._err.message || 'refused'); }   // no_round: the round was settled already, its done result is (or is about to be) in the inbox
      return it;
    }
  }
  const LOST = Symbol('lost');
  // what the server did while this screen waited, in words (U16): a timeout, a dropped line, autoplay, or a person deciding on another screen
  const sq = (p) => 'R' + (((p / E.COLS) | 0) + 1) + ' C' + ((p % E.COLS) + 1);
  function whyLine(k, it, dflt) {
    const a = it.auto, pk = it.pull && it.pull.pick, mo = it.pull && it.pull.more;
    if (a === 'timeout') return "TIME'S UP: " + dflt;
    if (a === 'disconnect') return 'Line dropped: ' + dflt;
    if (a === 'autoplay') return 'AUTO: ' + dflt;
    return k === 'pick' ? (pk && pk.p != null ? 'Lead ' + sq(pk.p) + ' picked on your other screen' : 'Lead picked on your other screen') : mo ? (mo.take ? 'Called once more on your other screen' : 'Banked on your other screen') : 'Decided on your other screen';
  }
  const RIB_WHY = { disconnect: 'LINE DROPPED', autoplay: 'AUTO', other: 'OTHER SCREEN' };   // CC.pull.expired always writes TIME'S UP: for every other cause the ribbon is rewritten after it
  const ribWhy = (ctx, why) => { if (why !== 'timeout') ctx.rib(ctx.modeName || 'DECISION', RIB_WHY[why] || ''); };
  const DROP_ERR = new Set(['rate', 'no_round']);                       // U8: an error that answers `ready` (a double-send, a settled round) never ends the round; only one answering a decide does
  async function decisionPoint(ctx, k, pend) {
    const id = ctx.p.roundId, box = inbox.get(id); if (!box) throw new Abort('no inbox');
    if (ctx.dropped) throw new Abort('dropped');
    const dflt = DEFAULT_TXT[k], dbgRow = { k, shown: false, how: null };
    (ctx.decisions || (ctx.decisions = [])).push(dbgRow);
    // the server already settled this round (timeout / disconnect default while the animation ran): no prompt, just the caption
    while (box.q.length) {
      const it = box.q.shift(); if (it._voided) throw new Abort('voided'); if (it._dropped) throw new Abort('dropped'); if (it._err) continue;
      advance(ctx, it); dbgRow.how = it.auto || 'early'; say('idle', whyLine(k, it, dflt)); await wait(500); return it;
    }
    // autoplay with a server that still asked: take the default, no prompt
    if (st.auto) {
      const v = k === 'pick' ? Math.min(...pend.choices) : false; T.decide(id, k, v); dbgRow.how = 'auto';
      say('idle', 'AUTO: ' + dflt); const r = await nextResult(ctx, box, LOST_MS); advance(ctx, r); return r;
    }
    const reg = { closed: false, close() {} }, iv = { id: 0 };
    // ONE MORE CALL: the server's whole-cent figures are what is shown AND what is paid. The WIN meter reads the bank amount while the prompt is up (the meter has run on exact tenths so far)
    if (k === 'more' && Number.isFinite(pend.bankCents)) { ctx.bankCents = pend.bankCents; if (ctx.frac) setWin(pend.bankCents, false, 0, true); }
    ctx.promptOpen = k; ctx.promptOpenedAt = performance.now(); dbgRow.shown = true;
    // the prompt is on screen: assume the server's `ready` re-arm gives a full clock (shown at once, no flicker); its g:coldcall:timer reply (authoritative) corrects it, a `rate` error on ready is ignored
    { const t = ctx.timer; t.at = Date.now(); t.expiresAt = t.at + (t.timeoutMs || 20000); t.synced = false; t.assumed = true; }
    T.ready(id);
    const prompt = ask(ctx, k, pend, reg);
    const expiry = new Promise((res) => { iv.id = setInterval(() => { if (ctx.timer.left() <= 0) { clearInterval(iv.id); res({ expired: true }); } }, 150); });
    let w;
    try {
      for (;;) {
        w = await Promise.race([prompt.then((v) => ({ v })), boxWait(box).then(() => ({ q: 1 })), expiry]);   // the queue branch only SIGNALS: a loser must never shift an item the next wait needs
        const head = 'q' in w && box.q[0]; if (head && head._err && DROP_ERR.has(head._err.code)) { box.q.shift(); continue; }
        break;
      }
      if (w.expired) {                                          // the UI never decides on its own: show TIME'S UP and wait for the server's default
        reg.close('timeout'); P('expired', 'timeout', { k, default: dflt }); say('idle', "TIME'S UP: " + dflt); dbgRow.how = 'timeout';
        const r = await nextResult(ctx, box, LOST_MS); advance(ctx, r); await wait(900); return r;   // the caption stays readable before the animation goes on
      }
      if ('q' in w) {                                           // an unsolicited result while the prompt was up
        const it = box.q.shift(); if (!it) throw new Abort('empty'); if (it._voided) throw new Abort('voided'); if (it._err) throw new Abort(it._err.message || 'refused');
        if (it._dropped) { reg.close('disconnect'); P('expired', 'disconnect', { k, default: dflt }); ribWhy(ctx, 'disconnect'); say('idle', 'Line dropped. Checking your call...'); dbgRow.how = 'dropped'; throw new Abort('dropped'); }
        const why = it.auto || 'other'; reg.close(why); P('expired', why, { k, default: dflt }); ribWhy(ctx, why); say('idle', whyLine(k, it, dflt)); dbgRow.how = it.auto || 'unsolicited';
        advance(ctx, it); await wait(900); return it;
      }
      reg.close(null); T.decide(id, k, w.v); dbgRow.how = 'player'; dbgRow.v = w.v;
      const r = await nextResult(ctx, box, LOST_MS); advance(ctx, r); st.skip = false; return r;
    } finally { clearInterval(iv.id); ctx.promptOpen = null; if (!reg.closed) reg.close(null); }
  }
  function ask(ctx, k, pend, reg) {                             // Promise<value> (pick: the square, more: take?). reg.close(why) removes the prompt.
    const fn = CC.pull && CC.pull[k === 'pick' ? 'askPick' : 'askMore'];
    const mine = () => placeholder(ctx, k, pend, reg);
    if (typeof fn !== 'function') return mine();
    reg.close = () => { reg.closed = true; };                   // the hook closes its own prompt once it has a value; decisionPoint tells it about a server default with CC.pull.expired
    return Promise.resolve().then(() => fn.call(CC.pull, pend, ctx)).catch((e) => { dbg.pull.push('ask ' + k + ': ' + (e && e.message)); return reg.closed ? new Promise(() => {}) : mine(); });
  }
  // plain buttons in a scrim that leaves the board visible and tappable (squares for a pick); builder B's CC.pull.askPick / askMore replace it
  function placeholder(ctx, k, pend, reg) {
    return new Promise(async (res) => {
      let dispose = null, tick = 0;
      reg.close = (why) => { reg.closed = true; clearInterval(tick); if (dispose) dispose(); const sc = ov.querySelector('.scrim.ph'); if (sc && sc._done) sc._done('x'); };
      while (!reg.closed) {
        const secs = () => Math.ceil(ctx.timer.left() / 1000);
        let html;
        if (k === 'pick') {
          const b = pend.choices.map((p) => `<button class="btn alt" data-v="${p}" data-pick="${p}" style="padding:6px 12px;font-size:16px">R${((p / E.COLS) | 0) + 1} C${(p % E.COLS) + 1}</button>`).join('');
          html = `<div class="card"><h2>PICK A LEAD</h2><p>Tap a lit square (or a button). That lead gets the better call. <small>Time left: <span class="ccT">${secs()}</span>s</small></p><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${b}</div></div>`;
        } else {
          const hasC = Number.isFinite(pend.bonusCents), W = ctx.dollars(hasC ? pend.bonusCents : Math.round(ctx.cents(pend.W))), X = ctx.dollars(hasC ? pend.bonusCents * pend.mult : Math.round(ctx.cents(pend.W * pend.mult)));
          html = `<div class="card"><h2>ONE MORE CALL?</h2><p>The bonus paid <b>${W}</b>. Hang up and keep it, or call once more: ${Math.round(pend.pWin * 1000) / 10}% to win <b>${X}</b>, otherwise <b>${ctx.dollars(0)}</b>. <small>Time left: <span class="ccT">${secs()}</span>s</small></p><button class="btn" id="cc_more_take" data-v="take">ONE MORE CALL</button><button class="btn alt" id="cc_more_bank" data-v="bank">HANG UP: KEEP ${W}</button></div>`;
        }
        const pm = modal(html), sc = ov.lastElementChild; sc.classList.add('ph'); sc.style.background = 'none'; sc.style.pointerEvents = 'none'; sc.style.alignItems = 'end';
        const card = sc.firstElementChild; if (card) card.style.pointerEvents = 'auto';
        clearInterval(tick); tick = setInterval(() => { const e = sc.querySelector('.ccT'); if (e) e.textContent = secs(); }, 250);
        if (k === 'pick') dispose = CC.board.pickTargets(pend.choices, (p) => sc._done(String(p)));
        const v = await pm; clearInterval(tick); if (dispose) { dispose(); dispose = null; }
        if (reg.closed) return;
        if (k === 'pick') { const p = +v; if (pend.choices.includes(p)) return res(p); }
        else if (v === 'take' || v === 'bank') return res(v === 'take');
        // Escape / Space closed it: ask again (a decision is never skipped)
      }
    });
  }
  // after a taken ONE MORE CALL: the reveal (CC.pull.moreOutcome or a stamp), then the WIN meter moves to the final total (the one place it may go DOWN)
  async function moreOutcome(ctx) {
    const p = ctx.p, m = p.pull && p.pull.more; if (!m || p.status === 'pending') return;
    if (m.take) {
      const shown = await PA('moreOutcome', m, ctx);
      if (shown === undefined && !(CC.pull && CC.pull.moreOutcome)) { ctx.stamp(m.won ? 'ONE MORE CALL: WON' : 'ONE MORE CALL: LOST', m.won ? 'x' + m.mult : 'the bonus is gone', 1500, null, m.won ? 'hi' : ''); if (m.won) SFX_.win(2); else SFX_.sting(); await wait(1500); }
      const delta = ctx.run.total - ctx.run.t; ctx.run.raw += delta; ctx.run.t = ctx.run.total;
      await setWin(p.totalWin, true, 700, true);                  // the server's whole cents (a lost gamble is the one drop; at a fractional bet the exact running total may sit a cent off)
    } else if (p.auto === 'autoplay') { say('idle', 'AUTO: banked'); }   // U16: AUTO is autoplay only; a timeout was already captioned TIME'S UP
    ctx.cur.more = m.take ? (m.won ? 'won' : 'lost') : 'banked';
  }

  async function animateRound(ctx) {
    const p = ctx.p, S = ctx.script;
    if (S.spin) {
      ctx.rib(S.buy === 'call' ? 'THE CALL' : S.buy === 'hunt' ? 'BELL HUNT' : 'DIALING', ''); await playSpin(ctx, S.spin);
      ctx.rib(RIB_IDLE, maxTxt());
      if (S.spin.bells === 2 && !S.bonus) await tease(ctx);
    } else if (ctx.callback) { ctx.rib('THE CALLBACK', ''); say('buy', 'Callback time. This one is free.'); SFX_.sting(); await wait(700); }
    else { say('buy'); SFX_.sting(); await wait(500); }
    ctx.cur.base = true;
    if (S.bonus) { if (S.spin) CC.hero.mood('hype', 1800); await CC.bonus.run(ctx); }
    if (ctx.p.status === 'pending') throw new Abort('still open');
    if (ctx.run.t !== ctx.run.total) { dbg.mismatch.push({ round: ctx.p.roundId, what: 'running total', shown: ctx.run.t, script: ctx.run.total }); await ctx.addWin(ctx.run.total - ctx.run.t, 400); }
    ctx.rib(RIB_IDLE, maxTxt());
    return ctx;
  }
  function sweep(keepHot) {                                    // end-of-round cleanup: nothing created for a round may outlive it (keepHot: the warm squares shown while idle stay lit)
    ov.querySelectorAll('.scrim,#tier,#tierbg,.fly,.banner').forEach((n) => n.remove()); stage.querySelectorAll('.toast.keep').forEach((n) => n.remove());
    floatsEl.replaceChildren(); board.querySelectorAll('.stamp,.accept').forEach((n) => n.remove()); $('head').querySelectorAll('.stamp').forEach((n) => n.remove()); stage.querySelectorAll(':scope > .stamp').forEach((n) => n.remove()); sceneEl.replaceChildren(); $('bh').hidden = true;
    stage.classList.remove('bonus', 'bw'); st.pace = 1; CC.fx.clear(); SFX_.duck(false); CC.board.clean(keepHot); st.modal = ov.querySelectorAll('.scrim').length; st.mirror = null;
  }
  // the screen against the script, after every round: win readout, 30 cells, no leftovers, final grid. Anything off lands in CC.dbg.mismatch.
  function selfCheck(p, ctx) {
    dbg.checked = (dbg.checked || 0) + 1; const bad = (what, shown, script) => dbg.mismatch.push({ round: p.roundId, what, shown, script });
    const bs = CC.board.state(), S = ctx.script, capped = !!(p.maxed || S.capped || ctx.capped);
    if (!capped && ctx.run.raw !== ctx.run.total) bad('script adds', ctx.run.raw, ctx.run.total);
    if (st.winShown !== p.totalWin) bad('win readout (cents)', st.winShown, p.totalWin);
    if (ctx.frac ? Math.abs(p.totalWin - ctx.cents(p.totalWinTenths)) > 2 : p.totalWin !== ctx.cents(p.totalWinTenths)) bad('server cents', p.totalWin, ctx.cents(p.totalWinTenths));   // fractional: whole cents within 2c of the exact amount (base and bonus round apart)
    if (p.pay && Number.isFinite(p.pay.win) && p.pay.win !== p.totalWin) bad('pay.win', p.pay.win, p.totalWin);
    if (bs.cells !== 30) bad('cells', bs.cells, 30); if (bs.ovl) bad('overlay nodes', bs.ovl, 0); if (bs.hot) bad('hot squares', bs.hot, 0);
    const left = floatsEl.children.length + ov.children.length + sceneEl.children.length + stage.querySelectorAll('.stamp,.accept,.banner,.fly,.flash').length; if (left) bad('leftover nodes', left, 0);
    const last = S.bonus && S.bonus.spins.length ? S.bonus.spins[S.bonus.spins.length - 1] : S.spin; if (last) { const g = last.steps.length ? last.steps[last.steps.length - 1].grid : last.grid, dom = CC.board.domGrid(); for (let i = 0; i < 30; i++) if (dom[i] !== E.SYM[g[i]]) { bad('final grid', dom.join(), g.map((x) => E.SYM[x]).join()); break; } }
    if (CC.fx.running()) bad('fx loop running', 1, 0);
    // ONE MORE CALL: the meter must have landed on the server's final total whichever way it went (a lost gamble is the only drop)
    const m = p.pull && p.pull.more; if (m && m.take && ctx.run.t !== ctx.run.total) bad('more total', ctx.run.t, ctx.run.total);
    if (ctx.callback && p.cost !== 0) bad('callback cost', p.cost, 0);
  }
  const allSpins = (S) => [...(S.spin ? [S.spin] : []), ...(S.bonus ? S.bonus.spins : [])];
  let autoT = 0;

  // ---- one request: balance bookkeeping and the spin, then the shared round runner
  async function play(kind) {
    if (st.busy) { if (kind === 'spin' && !promptUp()) { st.skip = true; st.tap++; if (CC.bonus && CC.bonus.poke) CC.bonus.poke(); } return; }
    if (st.modal) return;
    if (kind !== 'spin' && cbPending()) { toast('Play your Callback first.', 2000); return; }
    const v = pview(), cbv = st.live && kind === 'spin' && v && v.cb ? v.cb : null;       // a Callback is pending: this spin is it (free, at its own bet)
    const b = bet(), cost = cbv ? 0 : costC(kind, b);                      // whole cents: the bet, or the server's buy price at this bet
    if (avail() < cost) { toast(kind === 'spin' ? 'Not enough funds. Lower your bet.' : 'Not enough funds for that bonus.'); st.auto = false; $('auto').classList.remove('on'); return; }
    if (P('endGhost')) syncWarm();   // (chris 10-06 FB1) a would-have-closed stamp still showing is dropped, the warm squares come back
    SFX_.init(); wake(); dbg.started = (dbg.started || 0) + 1; setBusy(true); st.skip = false; CC.hero.set('idle'); sweep(true); resetWin(); st.cbBet = cbv ? cbv.bet : null; drawBet(); setBal(st.bal - cost, true); SFX_.spin(); say(kind === 'spin' ? 'spin' : 'buy');
    let p;
    try { p = await T.spin(b, st.mode, kind === 'spin' ? null : kind, st.auto); }
    catch (e) {
      st.cbBet = null;
      if (e.open && st.live) { setBal(walletBal(), true); toast('Finishing your open call.', 2000); return runRound(e.open, e.open.buyBonus || 'spin', true); }   // another tab / a reload left a decision open: play it out
      setBal(st.live ? walletBal() : st.pracBal, true); setBusy(false); drawBet(); syncWarm();
      if (e.server) { toast(e.message || 'Spin refused.', 2400); st.auto = false; $('auto').classList.remove('on'); } else toast('No answer from the server.', 2400);
      if (st.live) requestState();   // (P6 w3a) a refused or unanswered spin / buy (round_closed, internal, funds): the balance, the Callback and an open round are read again from the server, never kept from this screen's copy
      return;
    }
    return runRound(p, kind, false);
  }
  // animate a round from its first result to its done result, then settle the screen. `adopted`: a round that was already open (reload, other tab): nothing was charged here.
  async function runRound(p, kind, adopted) {
    const b = p.betCents || p.bet || bet(), S0 = p.script || p.partial;
    if (adopted) { P('endGhost'); setBusy(true); st.skip = false; CC.hero.set('idle'); sweep(true); resetWin(); setBal(walletBal(), false); }
    st.cbBet = p.callback ? b : null; drawBet();
    const cost = p.cost != null ? p.cost : 0;
    const row = { id: p.roundId, kind, forced: p.forced || null, tease: !!(S0.spin && S0.spin.bells === 2 && !S0.bonus), cluster: S0.spin ? S0.spin.cluster : 0, bigClose: allSpins(S0).some((s) => s.phone && s.phone.rounds.some((r) => r.collects.some((c) => c.value >= 250))), bonus: S0.bonus ? S0.bonus.kind : null, phone: !!((S0.spin && S0.spin.phone) || (S0.bonus && S0.bonus.spins.some((s) => s.phone))), tier: p.tier, win: p.totalWinTenths, callback: !!p.callback, adopted: !!adopted, first: p.status || 'done' };
    dbg.rounds.push(row);
    let ctx = null, aborted = null, ghostNow = null;
    try { ctx = makeCtx(p, b, kind); st.ctx = ctx; ctx.rd = inbox.get(p.roundId) || mkBox(p.roundId); await animateRound(ctx); }
    catch (e) { if (e instanceof Abort) aborted = e; else { console.error(e); dbg.error = String(e && e.stack || e); } }
    if (aborted) return abortRound(p, ctx, aborted, row);
    // finish: whatever happened above, show the exact server total and balance, then clean up
    const f = ctx ? ctx.p : p;                                  // the final (done) result of the round
    if (f.status === 'pending') return abortRound(p, ctx, new Abort('never settled'), row);
    Object.assign(row, { tier: f.tier, win: f.totalWinTenths, auto: f.auto || null, decisions: ctx ? ctx.decisions.map((d) => d.how) : [], more: ctx ? ctx.cur.more || null : null });
    try {
      if (ctx && ctx.run.t !== ctx.run.total) await ctx.addWin(ctx.run.total - ctx.run.t, 200);
      if (!ctx) { st.winTarget = 0; await setWin(f.totalWin, false); }
      else if (ctx.frac && st.winShown !== f.totalWin) { await setWin(f.totalWin, true, 300, true); }   // fractional-cent round: the meter lands on the whole cents the server really paid
      const winX = f.totalWinTenths / 10, tier = E.winTier(winX), amt = f.totalWin;
      if (f.maxed || (ctx && ctx.capped) || (f.script && f.script.capped)) { stamp('MAX WIN', maxX().toLocaleString('en-US') + 'x. The round stops here.', 1700, null, 'hi'); SFX_.win(3); say('bigWin'); await wait(1400); }
      const lost = f.pull && f.pull.more && f.pull.more.take && !f.pull.more.won;   // U17: no BIG WIN tier after a lost gamble, the plain total only
      if (tier in TIER_LVL && lost) { stamp('NICE!', 'x' + (winX >= 10 ? Math.round(winX) : winX.toFixed(1).replace(/\.0$/, '')), 1300); SFX_.win(1); say('smallWin'); await wait(900); }
      else if (tier in TIER_LVL) await bigWin(winX, amt, tier);
      else if (tier === 'sweet' || tier === 'nice') { stamp(tier === 'sweet' ? 'SWEET!' : 'NICE!', 'x' + (winX >= 10 ? Math.round(winX) : winX.toFixed(1).replace(/\.0$/, '')), 1300); SFX_.win(tier === 'sweet' ? 2 : 1); say(tier === 'sweet' ? 'nice' : 'smallWin'); await wait(900); }
      else if (amt > 0) { SFX_.coin(); say('smallWin'); }
      else if (f.totalWinTenths > 0) { say('idle', 'Under one cent: it rounded down, nothing paid this time.'); }
      else {
        st.dead = kind === 'spin' ? st.dead + 1 : 0;
        if (st.dead >= RAGE_STREAK) { st.dead = 0; CC.hero.set('rage', 2400); say('rage'); }
        else if (Math.random() < 0.5) say('lose');
      }
      if (amt > 0) st.dead = 0;
      // pull extras: the pot prize (on top of the win), the would-have-closed ghost (a dead-ish base spin only, off in turbo, never with a bonus)
      if (st.live && f.pot && f.pot.won) { row.pot = f.pot.amount; if (CC.pull && CC.pull.potWin) await PA('potWin', f.pot, ctx); else { toast('POT WON: ' + dollars(f.pot.amount), 2600); SFX_.win(3); await wait(1200); } }
      const gh = st.live && f.pull && f.pull.ghost;
      if (gh && gh.pay > 0 && !st.turbo && !(f.script && f.script.bonus)) { row.ghost = gh.pay; ghostNow = gh; }   // (chris 10-06 FB1) not awaited here: it plays after the round is settled and SPIN is free (see below)
    } catch (e) { console.error(e); dbg.error = String(e && e.stack || e); }
    sweep();
    if (ctx) selfCheck(f, ctx); else dbg.mismatch.push({ round: f.roundId, what: 'animation error', shown: dbg.error || '', script: '' });
    st.rounds++; st.ctx = null; st.cbBet = null; inbox.delete(f.roundId);
    if (st.live) {
      if (f.pull && f.pull.state) st.pv[f.mode || st.mode] = f.pull.state;
      setBal(walletBal(), true); dbg.lastBal = { shown: st.bal, wallet: walletBal() };
      row.cost = cost; row.totalWin = f.totalWin; row.potWon = f.pot && f.pot.won ? f.pot.amount : 0; row.wallet = walletBal();
      toParent({ type: 'round', win: f.totalWin, bet: b, mode: st.mode, tier: f.tier });
      if (f.pull) { const lg = PA('leadGain', f.pull); if (f.pull.armed) await Promise.race([lg, delay(4000)]); }   // (chris 10-06 FB1) the leads note (count, bar, +N LEADS, banners) runs on its own time and never holds SPIN; only the Callback announcement does
      syncView();
    } else { st.pracBal += f.totalWin - cost; if (st.pracBal < bet()) { st.pracBal = 100000; toast('Out of practice money. Free refill.', 2200); } setBal(st.pracBal, true); }
    st.skip = false; setBusy(false); wake(); syncWarm();
    const gp = ghostNow ? PA('ghost', ghostNow, ctx).then(() => syncWarm()) : null;   // (chris 10-06 FB1) the would-have-closed stamp plays on a free button; the next spin (or a bet change) ends it via CC.pull.endGhost
    if (st.auto) { const arm = () => { clearTimeout(autoT); autoT = setTimeout(() => { if (st.auto && !st.busy) play('spin'); }, 450 * speed()); }; if (gp) gp.then(arm); else arm(); }
  }
  // the screen cannot finish this round (voided by the server, a decision refused, the line went quiet): clean up and let the server's state decide what is true
  function abortRound(p, ctx, why, row) {
    row.aborted = why.message; dbg.aborted = (dbg.aborted || 0) + 1; sweep(); st.ctx = null; st.cbBet = null; inbox.delete(p.roundId); st.skip = false;
    if (why.message === 'dropped' && st.settle && st.settle.id === p.roundId) { st.settle.aborted = true; tryFinishSettle(); return; }   // the screen stays busy until the history says what became of the round
    toast(why.message === 'voided' ? 'That call was cancelled. Your bet is refunded.' : 'Lost the line. Your round is settled on the server.', 3000);
    if (st.live) { setBal(walletBal(), true); toParent({ type: 'hello' }); if (T.sock) T.sock.emit('g:coldcall:state', {}); }
    setBusy(false); wake(); syncWarm();
  }
  // a round that was open when the page loaded (state.open) or that another tab of the account started: play it from the beginning of what the server says was seen
  function adopt(p) {
    if (!p || !st.live || st.busy || st.modal) return false;
    if (p.mode && p.mode !== st.mode) { st.mode = p.mode; modeUi(); toParent({ type: 'mode', mode: st.mode }); }
    mkBox(p.roundId); dbg.adopted = (dbg.adopted || 0) + 1; applyWallet(p.wallet || p.balances);
    runRound(p, p.buyBonus || 'spin', true); return true;
  }

  // ------------------------------------------------------------------ transports: practice (local engine), shell bridge, standalone socket
  // One request per spin; after that everything is keyed by roundId: every result of a round lands in that round's inbox (pending, the next pending, done, or an
  // unsolicited done from a server timeout / disconnect default), and the animation takes them in order. Nothing waits on queue position.
  const pend = new Map(); let reqSeq = 0;
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  const inbox = new Map();                                      // roundId -> { q: [result | { _err } | { _voided }], prom, res }
  const mkBox = (id) => { let e = inbox.get(id); if (!e) { e = { id, q: [], prom: null, res: null }; inbox.set(id, e); } return e; };
  const boxPush = (e, it) => { e.q.push(it); if (e.res) { const r = e.res; e.res = e.prom = null; r(); } };
  const boxWait = (e) => (e.q.length ? Promise.resolve() : (e.prom = e.prom || new Promise((r) => { e.res = r; })));   // resolves when the queue is not empty; the consumer shifts
  const T = {
    kind: 'practice',
    spin(b, mode, buy, auto) {
      if (!st.live) return Promise.resolve(localRound(b, buy));
      return new Promise((resolve, reject) => {
        const id = ++reqSeq, t = setTimeout(() => { pend.delete(id); reject(new Error('timeout')); }, 20000);
        pend.set(id, { mode: st.mode, bet: b, buy: buy || null, ok: (x) => { clearTimeout(t); resolve(x); }, err: (e) => { clearTimeout(t); reject(e); } });
        if (BRIDGE) toParent({ type: 'spin', reqId: id, bet: b, mode: st.mode, buy, auto: !!auto });
        else T.sock.emit('g:coldcall:spin', { bet: b, mode: st.mode, ...(buy ? { buyBonus: buy } : {}), auto: !!auto, ...(QFORCE ? { force: QFORCE } : {}) });
      });
    },
    decide(roundId, k, v) {                                     // k 'pick': v = the square; k 'more': v = take (boolean)
      if (!st.live) return; const m = k === 'pick' ? { roundId, k, p: v } : { roundId, k, take: !!v };
      if (BRIDGE) toParent({ type: 'decide', reqId: ++reqSeq, ...m }); else if (T.sock) T.sock.emit('g:coldcall:decide', m);
    },
    history() { if (!st.live) return; if (BRIDGE) toParent({ type: 'history' }); else if (T.sock) T.sock.emit('g:coldcall:history', {}); },
    ready(roundId) {                                            // the prompt is on screen: the server restarts the decision timer (and answers with g:coldcall:timer)
      if (!st.live) return;
      if (BRIDGE) toParent({ type: 'ready', roundId }); else if (T.sock) T.sock.emit('g:coldcall:ready', { roundId });
    }
  };
  function localRound(b, buy) {                                 // practice only (no wallet at stake). Same engine file, same script.
    const seed = crypto.getRandomValues(new Uint32Array(1))[0], rng = E.rngFrom(seed);
    const r = E.resolveRound(rng, buy, !buy && QFORCE ? { force: QFORCE } : undefined);
    return { roundId: 'p' + seed.toString(16), script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, cost: E.cents(r.costTenths, b), totalWin: E.cents(r.winTenths, b), tier: r.tier, maxed: r.capped, forced: QFORCE || undefined };
  }
  const firstPend = () => { const id = pend.keys().next().value, w = pend.get(id); if (w) pend.delete(id); return w; };
  const pendFirst = () => pend.get(pend.keys().next().value);
  function onResult(p) {                                        // a g:coldcall:result (socket event or bridge message)
    if (!p || typeof p !== 'object') return;
    if (p.wallet || p.balances) applyWallet(p.wallet || p.balances);
    const box = p.roundId && inbox.get(p.roundId);
    if (box) return boxPush(box, p);                            // a result of the round on screen (the answer to a decide, or unsolicited)
    // U3: the answer to THIS tab's spin is a result that is not `resolved` (a round settled out from under someone), in the mode asked, for the bet asked (a Callback plays at its own)
    const q = pendFirst();
    if (q && !p.resolved && p.mode === q.mode && (p.callback || (p.betCents != null ? p.betCents : p.bet) === q.bet) && ((p.buyBonus || null) === (q.buy || null) || p.callback)) {
      const w = firstPend(); if (!(p.script || p.partial)) return w.err(new Error('bad result')); mkBox(p.roundId); return w.ok(p);   // the answer to the spin request
    }
    (dbg.stray = dbg.stray || []).push({ id: p.roundId, status: p.status, mode: p.mode });
    if (st.live && !st.busy && p.status === 'pending') adopt(p);   // another tab of the account started a round with a decision
    else if (st.live && p.status === 'done') {                      // a round of another tab / a default settled: that currency's view and wallet only, no animation
      if (p.pull && p.pull.state && (p.mode === 'play' || p.mode === 'chips')) st.pv[p.mode] = p.pull.state;
      if (p.resolved) toast('A call you left open was settled.', 2200);
      if (!st.busy && (!p.mode || p.mode === st.mode)) syncView();
    }
  }
  function onError(e) {                                         // a refused request: the spin in flight, else a decide of the round on screen
    e = e || {};
    const w = firstPend();
    if (w) return w.err(Object.assign(new Error(e.message || 'Spin refused.'), { server: true, code: e.code, open: e.open }));
    const c = st.ctx, box = c && inbox.get(c.p.roundId);
    if (box) boxPush(box, { _err: e }); else if (e.message && st.live && !st.busy) toast(e.message, 2400);
  }
  function onVoided(m) {                                        // the server refunded a round it could not finish
    if (!m) return; if (m.wallet) applyWallet(m.wallet);
    const box = m.roundId && inbox.get(m.roundId);
    if (box) boxPush(box, { _voided: m }); else if (!st.busy) { toast('A call was cancelled. Your bet is refunded.', 2600); toParent({ type: 'hello' }); }
  }
  function onTimer(m) {                                         // the server (re)started the decision timer (U5: a repeat with the same expiresAt changes nothing)
    const c = st.ctx; if (!m || !c || c.p.roundId !== m.roundId || !(m.timeoutMs > 0)) return;
    if (syncTimer(c.timer, m.expiresAt, m.timeoutMs)) P('timer', c.timer, c);
  }
  // ---- a dropped line (U6 / U7 / U11 / P4). The server settles a round the moment its owner's socket goes (banked default), or voids it on a restart. This screen
  // closes the prompt with a plain line at once, then after the reconnect asks the server's history what became of the round and says THAT: banked + amount, or
  // cancelled + refunded (only for a round that is in neither the history nor state.opens). The two stories are never mixed.
  const SEEN_KEY = 'cc_dc_seen';
  const seenGet = () => { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } };
  const seenSet = (id) => { try { localStorage.setItem(SEEN_KEY, id); } catch (e) { /* private mode: the line may repeat once */ } };
  const fmtMode = (mode, c) => (mode === 'chips' ? chipsFmt(c) + (chipsUsd() ? '' : ' chips') : usd(c));
  const opensOf = (sv) => (sv && (sv.opens || (sv.open ? [sv.open] : []))) || [];
  function markDropped(ctx, via) {
    if (!ctx || ctx.dropped || !ctx.p || ctx.p.status !== 'pending') return;
    ctx.dropped = true; const id = ctx.p.roundId;
    st.settle = { id, mode: ctx.p.mode || st.mode, via, asked: false, aborted: false, hist: undefined, t2: 0 };
    clearTimeout(st.settleCap); st.settleCap = setTimeout(() => { const x = st.settle; if (x && x.id === id) { x.hist = null; tryFinishSettle(); } }, 60000);   // the line never comes back: free the screen
    const box = inbox.get(id); if (box) boxPush(box, { _dropped: true });
    if (via === 'state') askHistory();
  }
  function onDisconnect() { if (st.live && st.ctx) markDropped(st.ctx, 'disconnect'); }
  function askHistory() {
    const x = st.settle; if (x) { if (x.asked) return; x.asked = true; clearTimeout(x.t2); x.t2 = setTimeout(() => { if (st.settle === x && x.hist === undefined) { x.hist = null; tryFinishSettle(); } }, 6000); }
    T.history();
  }
  function onHistory(m) {
    const rounds = m && Array.isArray(m.rounds) ? m.rounds : [], x = st.settle;
    if (x) { if (!x.asked) return; x.hist = rounds; tryFinishSettle(); return; }
    if (!st.histWanted) return; st.histWanted = false;                  // U11: a reload during a decision: the old page's socket went, the server banked it
    const h = rounds[0];
    if (h && h.auto === 'disconnect' && Date.now() - h.t < 600000 && seenGet() !== h.roundId && !st.busy) { seenSet(h.roundId); const msg = 'Your open call was banked: ' + fmtMode(h.mode, h.totalWin); toast(msg, 4500); say('idle', msg); }
  }
  function tryFinishSettle() {
    const x = st.settle; if (!x || !x.aborted || x.hist === undefined) return;
    clearTimeout(x.t2); clearTimeout(st.settleCap); st.settle = null;
    const open = opensOf(st.server).find((o) => o.roundId === x.id), h = x.hist && x.hist.find((r) => r.roundId === x.id);
    let msg = null;
    if (x.hist === null) msg = 'Line dropped. Your call is settled on the server.';
    else if (h) { seenSet(x.id); msg = 'Line dropped: your call was banked: ' + fmtMode(h.mode || x.mode, h.totalWin); }
    else if (!open) msg = 'That call was cancelled. Your bet is refunded.';
    if (msg) { toast(msg, 4500); say('idle', msg); }
    $('ribL').textContent = RIB_IDLE; $('ribR').textContent = maxTxt();
    setBal(walletBal(), true); setBusy(false); wake(); syncWarm(); syncView();
    if (open) adopt(open);
  }
  function onFloor(kind, ev) {                                  // floor:feed / floor:pot. Play $ events never show in Chips mode and the reverse.
    if (!st.live || !ev) return;
    if (kind === 'feed') {
      if (ev.id != null) { if (st.feedAll.some((x) => x.id === ev.id)) return; st.feedAll.push(ev); if (st.feedAll.length > 50) st.feedAll.shift(); }   // the state's last 20 and the live events overlap: each id once
      if (ev.mode && ev.mode !== st.mode) return; st.feedShown.add(ev.id); P('feed', { ...ev, you: !!st.me && ev.who === st.me });
    }
    else if (kind === 'pot') { const md = ev.mode; if (md !== 'play' && md !== 'chips') return; st.pot[md] = { ...(st.pot[md] || {}), bal: ev.bal }; if (md === st.mode) P('setPot', st.pot[md]); }
  }
  function feedReplay() {                                       // the ticker follows the mode: clear it, then show the recent events of this mode again
    st.feedShown.clear(); P('feedClear');
    st.feedAll.filter((ev) => !ev.mode || ev.mode === st.mode).slice(-20).forEach((ev) => { st.feedShown.add(ev.id); P('feed', { ...ev, you: !!st.me && ev.who === st.me }); });
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
  // the pull view of the current mode to the look layer; the warm squares on the board; the bet readout (Callback)
  function syncView() {
    drawBet();
    if (!st.live) return;
    P('setOn', !(st.rules && st.rules.on === false));            // rules.on === false: the PULL is switched off (no lead list, Callback, pot or decisions; spins are plain)
    const v = pview(); if (v) { P('setView', { ...v, at: Date.now() }, st.mode); P('onBetChange', bet()); }
    const pot = st.pot[st.mode]; if (pot) P('setPot', pot);
    syncWarm();
  }
  function syncWarm() {                                         // warm squares are tied to a bet: lit only at the bet they were made at (any other bet drops them at the spin)
    if (!st.live || st.busy || !CC.board || !CC.board.setHot) return;
    const v = pview(); CC.board.setHot(v && v.warm && v.warm.length && v.warmBet === bet() ? v.warm : [], true);
  }
  function goLive(m) {
    const first = !st.live;
    if (m.state) st.server = m.state;
    if (m.name) st.me = m.name;
    if (!st.live) { st.live = true; T.kind = BRIDGE ? 'bridge' : 'socket'; setBets(Array.isArray(m.bets) && m.bets.length ? m.bets : DEFAULT_BETS); }
    else if (Array.isArray(m.bets) && m.bets.length && st.bets.join() !== m.bets.join()) {   // the shell's wallet message can open the game live BEFORE the state does: the ladder (1c / 2c / 5c) arrives with the state, keep the bet the player is on
      const cur = bet(); st.bets = m.bets.slice(); const i = st.bets.indexOf(cur); if (i >= 0) st.betIdx = i; else setBets(m.bets);
    }
    if (m.mode === 'play' || m.mode === 'chips') st.mode = m.mode;
    applyWallet(m.wallet || m.balances); modeUi(); if (!st.busy) setBal(walletBal(), false);
    const s = m.state, pl = s && s.pull;
    if (pl && !st.busy) {
      for (const md of ['play', 'chips']) if (pl[md]) st.pv[md] = pl[md];
      if (s.pot) st.pot = { play: s.pot.play || null, chips: s.pot.chips || null };
      st.rules = pl.rules || null; P('rules', pl.rules || E.CFG.pull);
      if (Array.isArray(s.feed)) s.feed.forEach((ev) => onFloor('feed', ev));
    }
    // a reconnect whose state no longer lists the round this screen is still playing (server restart: voidStored refunded it): tell the round now, instead of
    // leaving the prompt up until its clock runs out under a "TIME'S UP: first lead picked" caption (real.js void, 26 s)
    if (s && s.pull && st.ctx && st.ctx.p.status === 'pending') {
      const id = st.ctx.p.roundId, box = inbox.get(id), opens = s.opens || (s.open ? [s.open] : []);
      if (box && !opens.some((o) => o.roundId === id) && !box.q.some((x) => x._voided || x.status === 'done')) markDropped(st.ctx, 'state');   // P4: banked or voided? the history tells (a banked round is never called refunded)
    }
    if (st.settle && !st.settle.asked) askHistory();
    if (first && s && s.pull && !s.open && !st.settle) { st.histWanted = true; T.history(); }
    if (!st.busy) syncView(); else drawBet();
    if (s && s.open && !st.busy && !st.modal) adopt(s.open);    // a decision was left open (reload, another tab): play it out
  }
  function goPractice(msg) { st.live = false; T.kind = 'practice'; pend.clear(); inbox.clear(); setBets(DEFAULT_BETS); setBal(st.pracBal, false); modeUi(); drawBet(); if (msg) toast(msg, 2400); }
  function setBets(list) { st.bets = list.slice(); const i = st.bets.indexOf(100); st.betIdx = i >= 0 ? i : Math.min(3, st.bets.length - 1); }   // the server's list (1c to $25), default bet $1
  const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const requestState = () => { if (!st.live) return; if (BRIDGE) toParent({ type: 'hello' }); else if (T.sock) T.sock.emit('g:coldcall:state', {}); };
  // g:coldcall:cfg (the admin changed the slot math): store the new numbers; the NEXT round uses them. A round in flight, a spin in animation and an open decision finish on what they started on:
  // nothing here touches a prompt, a timer or the board. Only the idle screen reads them: the bet / buy labels, the buy menu and the info screen when they are open.
  function onCfg(m) {
    if (!m || typeof m !== 'object' || !st.live) return;
    const sv = st.server || (st.server = {});
    if (m.cfg && typeof m.cfg === 'object') { sv.cfg = m.cfg; if (Number.isFinite(m.cfg.maxWinTenths)) sv.maxWinX = m.cfg.maxWinTenths / 10; if (m.cfg.buyCost) sv.buyCostX = Object.fromEntries(Object.entries(m.cfg.buyCost).map(([k, v]) => [k, v / 10])); }
    if (m.buyPriceCents && typeof m.buyPriceCents === 'object') sv.buyPriceCents = m.buyPriceCents;
    if (typeof m.rtp === 'string') sv.rtp = m.rtp;
    if (m.rules && typeof m.rules === 'object') { st.rules = m.rules; if (sv.pull) sv.pull.rules = m.rules; P('rules', m.rules); }
    if (Array.isArray(m.bets) && m.bets.length && !sameList(m.bets, st.bets)) { const cur = bet(); st.bets = m.bets.slice(); const i = st.bets.indexOf(cur); st.betIdx = i >= 0 ? i : Math.min(st.betIdx, st.bets.length - 1); }
    dbg.cfg = (dbg.cfg || 0) + 1;
    if (!st.busy) { drawBet(); if ($('ribR').textContent.startsWith('MAX ')) $('ribR').textContent = maxTxt(); syncView(); }
    refreshInfo(); refreshBuy();
    if (m.rules && m.rules.on && !st.pv[st.mode] && !st.busy) requestState();   // the PULL was off and is on again: the server's view for this account
  }
  function initTransport() {
    const bar = document.createElement('div'); bar.id = 'modebar';
    bar.innerHTML = '<div class="mb"><button data-m="play">Play $</button><button data-m="chips">Chips</button></div><span id="modenote"></span>'; stage.appendChild(bar);
    bar.addEventListener('click', (e) => { const x = e.target.closest('button'); if (!x || !st.live || st.busy) return; st.mode = x.dataset.m; SFX_.click(); resetWin(); setBal(walletBal(), false); modeUi(); feedReplay(); syncView(); toParent({ type: 'mode', mode: st.mode }); });
    modeUi();
    if (BRIDGE) {
      addEventListener('message', (ev) => {
        if (ev.source !== window.parent) return; const m = ev.data || {};
        if (m.type === 'init') goLive(m); else if (m.type === 'wallet') { if (st.live) applyWallet(m.wallet || m); else goLive(m); }
        else if (m.type === 'result') onResult(m.payload); else if (m.type === 'error') onError({ message: m.message || 'Spin refused.', code: m.code, open: m.open });
        else if (m.type === 'floor') onFloor(m.kind, m.payload); else if (m.type === 'timer') onTimer(m.payload); else if (m.type === 'voided') onVoided(m.payload); else if (m.type === 'cfg') onCfg(m.payload); else if (m.type === 'pref') { if (st.live && !st.busy) { setBal(walletBal(), false); syncView(); } }
        else if (m.type === 'disconnect') onDisconnect(); else if (m.type === 'history') onHistory(m.payload);
      });
      addEventListener('keydown', (e) => { if (e.key === 'Escape') toParent({ type: 'esc' }); });
      toParent({ type: 'hello' }); setTimeout(() => { if (!st.live) toParent({ type: 'practice' }); }, 2000);
    } else if (LIVE_SOCKET) {
      const name = Q.get('name') || 'ccdev', pin = Q.get('pin') || '4321', s = document.createElement('script'); s.src = '/socket.io/socket.io.js'; st.me = name;
      s.onload = () => {
        const sock = (T.sock = io()); let triedSignup = false;
        sock.on('connect', () => sock.emit('auth_login', { name, pin }));
        sock.on('auth_error', () => { if (!triedSignup) { triedSignup = true; sock.emit('auth_signup', { name, pin, avatar: 'a01' }); } });
        sock.on('auth_ok', () => sock.emit('g:coldcall:state', {}));
        sock.on('g:coldcall:state', (s2) => goLive({ wallet: s2.wallet, bets: s2.bets, state: s2, mode: st.live ? st.mode : 'play' }));
        sock.on('wallet', (w) => applyWallet(w));
        sock.on('g:coldcall:result', onResult); sock.on('g:coldcall:timer', onTimer); sock.on('g:coldcall:voided', onVoided);
        sock.on('disconnect', onDisconnect); sock.on('g:coldcall:history', onHistory);
        sock.on('g:coldcall:cfg', onCfg); sock.on('floor:feed', (e) => onFloor('feed', e)); sock.on('floor:pot', (e) => onFloor('pot', e));
        sock.on('error', onError);
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
    $('spin').addEventListener('click', () => { SFX_.init(); if (st.busy) { if (!promptUp()) { st.tap++; st.skip = true; } return; } st.tap++; play('spin'); });   // U1: while a decision is up SPIN is not a skip
    board.addEventListener('click', () => { if (promptUp()) return; st.tap++; if (st.busy) st.skip = true; });
    $('betDn').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.max(0, st.betIdx - 1); SFX_.click(); drawBet(); P('onBetChange', bet()); syncWarm(); });
    $('betUp').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.min(st.bets.length - 1, st.betIdx + 1); SFX_.click(); drawBet(); P('onBetChange', bet()); syncWarm(); });
    $('turbo').addEventListener('click', () => { st.turbo = !st.turbo; $('turbo').classList.toggle('on', st.turbo); SFX_.click(); });
    $('auto').addEventListener('click', () => { SFX_.init(); st.auto = !st.auto; $('auto').classList.toggle('on', st.auto); SFX_.click(); if (st.auto && !st.busy) play('spin'); });
    tog($('sfxBtn'), SFX_.isSfx()); tog($('musicBtn'), SFX_.isMusic());
    $('sfxBtn').addEventListener('click', () => { SFX_.init(); const on = SFX_.setSfx(!SFX_.isSfx()); tog($('sfxBtn'), on); if (on) SFX_.click(); });
    const postMusicPref = () => { if (window.parent !== window) window.parent.postMessage({ type: 'cc-music-pref', value: SFX_.isMusic() }, '*'); };
    $('musicBtn').addEventListener('click', () => { SFX_.init(); const on = SFX_.setMusic(!SFX_.isMusic()); tog($('musicBtn'), on); if (on) SFX_.music(stage.classList.contains('bonus') ? 'bonus' : 'base'); postMusicPref(); });
    // the shell radio shares this MUSIC switch ('music-enabled' in, 'cc-music-pref' out) and, while it is audible ('radio-active'), the synthesized hold music is held
    addEventListener('message', (ev) => {
      const m = ev.data; if (!m || (window.parent !== window && ev.source !== window.parent)) return;
      if (m.type === 'music-enabled') { SFX_.setMusic(!!m.value); tog($('musicBtn'), SFX_.isMusic()); if (SFX_.isMusic()) SFX_.music(stage.classList.contains('bonus') ? 'bonus' : 'base'); }
      else if (m.type === 'radio-active') SFX_.holdBed(!!m.value);
    });
    postMusicPref();
    stage.addEventListener('click', (e) => { if (e.target.closest('#tier, .scn')) st.tap++; });
    addEventListener('keydown', (e) => {
      const sc = ov.querySelector('.scrim');
      if (e.key === 'Escape' && sc) { e.stopImmediatePropagation(); sc._done && sc._done('x'); return; }
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (sc) { sc._done && sc._done('x'); return; } SFX_.init(); if (st.busy && promptUp()) return; st.tap++; st.busy ? (st.skip = true, CC.bonus && CC.bonus.poke && CC.bonus.poke()) : play('spin'); }
    });
    $('buy').addEventListener('click', async () => {
      if (st.busy || st.modal) return; if (cbPending()) { toast('Play your Callback first.', 2000); return; } SFX_.init(); SFX_.click();
      const b = bet(), list = buyList(b); if (!list.length) return;
      const opts = list.map(([id, c]) => `<button class="buyopt" id="buy_${id}" data-buy="${id}" data-v="${id}" ${avail() < c ? 'disabled' : ''}><b>${BUY_INFO[id][0]}</b><span>${buyDesc(id)}</span><em>${dollars(c)}</em></button>`).join('');
      const v = await modal(`<div class="card buymenu" data-bet="${b}"><h2>Buy a bonus</h2><div class="buygrid">${opts}</div><button class="btn alt" data-v="x">Not now</button></div>`, { backdrop: true });
      const hit = list.find(([id]) => id === v); if (!hit) return;
      const c = (buyList(b).find(([id]) => id === v) || hit)[1];                  // a price swap while the menu was open: the live one
      const ok = await modal(`<div class="card buyconfirm" data-buy="${v}" data-bet="${b}"><h2>Confirm</h2><p>Buy <b>${BUY_INFO[v][0]}</b> for <b class="bp">${dollars(c)}</b>?<br><small>The price is charged now and it plays straight away.</small></p><button class="btn" id="buy_confirm" data-v="yes">Confirm</button><button class="btn alt" data-v="x">Cancel</button></div>`, { backdrop: true });
      if (ok === 'yes') play(v);
    });
    $('info').addEventListener('click', openInfo);
  }
  // the info screen: the pay table, cap, spins and RTP line of the LIVE math (signed in: state.cfg / g:coldcall:cfg; practice and an older server: the engine copy). Built when it opens and
  // rebuilt in place when a g:coldcall:cfg arrives while it is open (scroll kept); it can only be open between rounds, so no prompt is ever repainted.
  const liveCfg = () => (st.live && st.server && st.server.cfg) || null;
  function infoCard() {
    const lc = liveCfg(), C = lc ? Object.assign({}, E.CFG, { bubbles: lc.bubbles || E.CFG.bubbles, upsell: lc.upsell || E.CFG.upsell, spins: lc.spins || E.CFG.spins, maxSpins: lc.maxSpins || E.CFG.maxSpins }) : E.CFG;
    const pay = (lc && lc.payTenths) || E.CFG.pay, x = (t) => { const n = t / 10; return n >= 100 ? String(Math.round(n)) : String(+n.toFixed(1)); };
    const head = ['5', '6', '7', '8', '9', '10', '11', '12', '13+'].map((s) => `<th>${s}</th>`).join('');
    const rows = E.SYM.slice(0, E.NREG).reverse().map((s) => `<tr><td class="sy"><img src="${CC.assets.symUrl(s)}" alt=""><span>${NAMES[s]}</span></td>${pay[s].map((t) => `<td>${x(t)}</td>`).join('')}</tr>`).join('');
    const range = (a) => x(a[0][0]) + 'x to ' + x(a[a.length - 1][0]) + 'x';
    const label = st.live && st.server && typeof st.server.rtp === 'string' && st.server.rtp ? 'RTP: ' + st.server.rtp.replace(/[<>&]/g, '') + '.' : '';   // exactly what the server sends ("custom settings, not measured" included)
    const small = st.live && st.bets.some((b) => b < 10) ? `<p><b>Small bets.</b> At 1c, 2c and 5c a win is paid in whole cents: the cent after the decimal point is rounded up or down at random, with the fraction as the odds, so the payback does not change. A win under one cent can pay a cent or nothing. Bonus prices are rounded to the nearest cent and play at a fair stake.</p>` : '';
    const bc = (lc && lc.buyCost) || E.CFG.buyCost, bl = buyList(bet());
    const buys = bl.length ? `<p><b>Buying a bonus.</b> ${bl.map(([id, c]) => `${BUY_INFO[id][0]} ${x(bc[id])}x your bet (${dollars(c)} at your bet)`).join(', ')}. The price is a whole number of cents, rounded to the nearest cent, and is charged before it plays.</p>` : '';
    return `<div class="card info"><h2>How it plays</h2>
        <p><b>Clusters.</b> Land 5 or more of the same symbol touching each other (up, down, left, right) to win. <b>The Closer</b> is wild for any pay symbol.</p>
        <p><b>Cascades.</b> A win clears the cluster and every other matching symbol on the board. The rest fall, new ones drop in, and it repeats while wins keep forming.</p>
        <p><b>Hot leads.</b> Every square in a winning cluster turns into a sticky note and stays lit while symbols fall.</p>
        <p><b>The Call.</b> When the cascade ends and a <b>rotary phone</b> is on the board, every hot lead is dialed and flips to a <b>quote bubble</b> (bronze ${range(C.bubbles.bronze)}, silver ${range(C.bubbles.silver)}, gold ${range(C.bubbles.gold)}), an <b>UPSELL</b> (${C.upsell.map((u) => 'x' + u[0]).join(' ')}, multiplies the bubbles and closes next to it) or <b>THE CLOSE</b>, which collects every bubble on the board. After a close the other leads are dialed again. The bubbles and closes on the board pay.</p>
        <p><b>Bells.</b> The desk bells that landed in a spin: 3 = DIALING FOR DOLLARS (${C.spins.bonus1} free spins, leads stay lit until a phone calls them), 4 = ALWAYS BE CLOSING (${C.spins.bonus2} free spins, leads stay lit the whole bonus), 5 or more = QUOTE ACCEPTED (${C.spins.bonus3} free spins, a phone on every spin, no bronze bubbles). In a bonus 2 bells add 2 spins, 3 add 4; 4 or more in DIALING FOR DOLLARS upgrades it to ALWAYS BE CLOSING. Up to ${C.maxSpins} spins.</p>
        ${buys}${small}<p class="tl">Pay for a cluster, x bet</p><div class="pt"><table><tr><th></th>${head}</tr>${rows}</table></div>
        <p><small>Max win ${maxX().toLocaleString('en-US')}x. ${label} Play money only: no deposits, no payouts.</small></p>
        <button class="btn" data-v="x">Close</button><div class="cue">SCROLL FOR THE PAY TABLE</div></div>`;
  }
  const infoCue = (cd) => { const cue = cd.querySelector('.cue'), chk = () => cue.classList.toggle('end', cd.scrollTop + cd.clientHeight >= cd.scrollHeight - 6); cd.addEventListener('scroll', chk); chk(); };
  async function openInfo() {
    if (st.busy || st.modal) return; SFX_.init(); SFX_.click();
    const pr = modal(infoCard(), { backdrop: true });
    infoCue(ov.querySelector('.card.info'));
    await pr;
  }
  function refreshInfo() {                                      // a live config swap while the info screen is open: rebuild it in place, same scroll
    const cd = ov.querySelector('.card.info'); if (!cd) return; const sc = cd.parentElement, top = cd.scrollTop;
    sc.innerHTML = infoCard(); const c2 = sc.querySelector('.card.info'); P('decorate', c2); infoCue(c2); c2.scrollTop = top;
  }
  function refreshBuy() {                                       // a live price swap while the buy menu / its confirm is open: the open one shows the new price (the server charges the live price)
    const m = ov.querySelector('.card.buymenu'), cf = ov.querySelector('.card.buyconfirm');
    if (m) {
      const b = +m.dataset.bet, list = buyList(b), g = m.querySelector('.buygrid'); if (!g) return;
      if (!list.length) { const sc = m.parentElement; if (sc && sc._done) sc._done('x'); return; }
      g.innerHTML = list.map(([id, c]) => `<button class="buyopt" id="buy_${id}" data-buy="${id}" data-v="${id}" ${avail() < c ? 'disabled' : ''}><b>${BUY_INFO[id][0]}</b><span>${buyDesc(id)}</span><em>${dollars(c)}</em></button>`).join('');
    }
    if (cf) {
      const b = +cf.dataset.bet, id = cf.dataset.buy, hit = buyList(b).find(([k]) => k === id), sc = cf.parentElement;
      if (!hit) { if (sc && sc._done) sc._done('x'); toast('That bonus is not on offer any more.', 2200); return; }
      const bp = cf.querySelector('.bp'), t = dollars(hit[1]); if (bp && bp.textContent !== t) { bp.textContent = t; toast('The price changed: now ' + t + '.', 2600); }
    }
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
    CC.board.idle(); $('ribR').textContent = maxTxt();
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
  CC.core = { boot, st, play, dollars, unit, meterTxt, shortAmt, xTxt, wait, anim, tween, speed, say, toast, stamp, floatAt, stagePt, localPt, modal, waitTap, setWin, bigWin, sweep, Tick, T, money, applyWallet, goLive, goPractice, E, stage, board, sceneEl, SFX: SFX_, FX: CC.fx,
    // pull hooks (transport -> look layer); also the way tests and builder B reach the round machinery
    onResult, onError, onTimer, onVoided, onCfg, buyList, openInfo, onDisconnect, onHistory, onFloor, adopt, syncView, syncWarm, pview, inbox, cbPending };
})();
