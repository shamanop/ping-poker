/* COLD CALL THE PULL, look layer: concept B (rolodex: decisions in the HUD, readouts in the bezel) with A's odds wording, C's stamp and C's sticky.
   It draws and tells the truth, nothing else: every number comes from the server view / pending payload / rules (state.pull.rules, else the engine copy E.CFG.pull).
   game.js (builder A) calls the CC.pull API below through a guarded wrapper; nothing here touches the transport. Practice (not signed in) never calls setView: no pull UI at all.
   Everything a prompt or a reveal creates lives in #ov / #scene / the HUD / the rule bar and is closed by the prompt itself or by a 100 ms watchdog (sweep() takes #scene and head stamps).
   ?mock=pull: CC.pull.demo(state[, mode]) shows idle | callback | pick | more | ghost | pot | gain without a server (QA only; changes nothing in game.js). */
(() => {
  const CC = (window.CC = window.CC || {});
  const $ = (id) => document.getElementById(id);
  const E = ColdCallEngine, K = () => CC.core;
  const Q = new URLSearchParams(location.search);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const app = $('app'), board = $('board'), head = $('head'), ribbon = $('ribbon'), hud = $('hud'), scene = $('scene'), ribL = $('ribL'), ribR = $('ribR');
  const el = (tag, cls, html, id) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (id) e.id = id; return e; };
  const S = { view: null, mode: 'play', pot: null, rules: null, bet: 0, prompt: null, rib: null, mine: null, idleKey: '', feed: [], fi: 0, phase: 0, seen: new Set(), demo: false, hold: null, bn: 0, potPend: null, potDone: false, lg: 0, gh: null };
  const ARM_MS = 600;                                           // U1: a decision ignores taps for its first 600 ms (a skip tap that started before the prompt must not answer it)
  const st = () => K().st;
  const live = () => !!st().live;
  const chips = () => live() && st().mode === 'chips';
  const money = (c) => K().dollars(c) + (chips() ? ' chips' : '');
  const betNow = () => { const s = st(); return s.bets[s.betIdx]; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const xTxt = (x) => (x >= 100 ? num(x) : String(+Number(x).toFixed(1))) + 'x';
  const BN = { bonus1: 'DIALING FOR DOLLARS', bonus2: 'ALWAYS BE CLOSING', bonus3: 'QUOTE ACCEPTED' };
  const dur = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return d ? d + ' d ' + h + ' h' : h ? h + ' h ' + mm + ' m' : mm + ' m'; };
  const ld1 = (n) => String(+Number(n).toFixed(1));                       // leads to one decimal (the daily is a token: 0.2 lead)
  const ldTxt = (n) => ld1(n) + (+ld1(n) > 1 ? ' leads' : ' lead');
  const pct2 = (p) => { const a = Math.round(p * 10000); return [String(+(a / 100).toFixed(2)), String(+((10000 - a) / 100).toFixed(2))]; };   // [wins, loses], always add to 100
  const rulesOf = () => S.rules || E.CFG.pull;
  const hold = (ctx, ms) => (ctx && ctx.demoHold ? new Promise((r) => { S.hold = r; }) : ctx.wait(ms));   // demo: stay on the state until demo release

  // ------------------------------------------------------------------ the persistent pieces (hidden until a live view arrives)
  const note = el('div', 'pl', '', 'plNote'), gain = el('div', 'pl', '', 'plGain'), leaf = el('div', 'pl pllip', '', 'plLeaf'), potb = el('div', 'pl pllip', '', 'plPot');
  const feedEl = el('span', 'pl r', '', 'plFeed'), bn = el('div', 'pl', '', 'plBn');
  [note, gain, leaf, potb, feedEl, bn].forEach((e) => { e.hidden = true; });
  note.innerHTML = '<div class="r1"><small id="plL">LEADS</small><b id="plN">0</b><em id="plOf">/ 0</em><div class="bar"><i id="plBar"></i></div></div><div class="cold" id="plCold"></div>';
  board.append(note, gain, leaf, potb); ribbon.appendChild(feedEl); head.appendChild(bn);

  // ------------------------------------------------------------------ view readouts
  const coldLeft = () => { const v = S.view; return v && v.cold ? v.cold.inMs - (Date.now() - (v.at || Date.now())) : null; };
  function drawCold() {
    const v = S.view, c = v && v.cold, e = $('plCold'); if (!c) { note.classList.add('nocold'); return; }
    const left = coldLeft(), n = c.leads, w = c.warm | 0, R = rulesOf().cold || {};
    const part = n ? 0 : Math.max(0, Math.min(Math.round((R.batch || 0) * 10), (v.lt || 0) - Math.round((R.floor || 0) * 10))) / 10;   // under one whole lead at risk: the fraction (view.lt is in tenths)
    if (!n && !w && !part) { note.classList.add('nocold'); return; }
    note.classList.remove('nocold');
    const subj = n ? `<u>${num(n)} ${n === 1 ? 'lead' : 'leads'}</u>` + (w ? ` + ${w} warm` : '') : part ? `<u>${ld1(part)} lead</u>` + (w ? ` + ${w} warm` : '') : `<u>${w} warm ${w === 1 ? 'lead' : 'leads'}</u>`;
    const one = n ? n + w === 1 : (part && !w) || (!part && w === 1);
    e.innerHTML = `${subj} ${one ? 'goes' : 'go'} cold ${left <= 0 ? 'now' : 'in ' + dur(left)}`; e.classList.toggle('long', w > 0 || n >= 100);
  }
  function drawNote(shown) {
    const v = S.view; if (!v) return; const full = !!v.cb, list = v.list || 0, n = shown != null ? shown : v.leads;
    $('plN').textContent = full ? num(Math.max(n, list)) : num(n); $('plOf').textContent = '/ ' + num(list); $('plL').textContent = full ? 'FULL' : 'LEADS';
    note.classList.toggle('full', full); $('plBar').style.setProperty('--w', (full ? 100 : Math.max(0, Math.min(100, (n / Math.max(1, list)) * 100))).toFixed(1) + '%'); drawCold();
  }
  function drawLeaf() {
    const d = S.view && S.view.daily; if (!d) { leaf.hidden = true; return; }
    leaf.classList.toggle('kept', !!d.claimed);
    if (d.claimed) leaf.innerHTML = `<small>APPT KEPT</small><b>DAY ${d.streak}</b>`;
    else if (d.next > 0) leaf.innerHTML = `<small>APPT</small><b>+${ld1(d.next)}<i>${+ld1(d.next) > 1 ? 'leads' : 'lead'}</i></b>`;
    else leaf.innerHTML = '<small>APPT</small><b>free leads</b>';
    leaf.classList.toggle('s', !d.claimed && !(d.next > 0));
  }
  // P3: the winner's pot mug keeps the old balance until the pot-win card is gone (the emptied balance arrives with the round's result, seconds before YOU TOOK IT)
  function potHeld() { const s = st(), c = s.busy && s.ctx; if (!c) return false; const p = c.p; return !!((p.pot && p.pot.won && !S.potDone) || (p.status === 'pending' && !c.promptOpen)); }
  function potFlush() { if (!S.potPend) return; S.pot = S.potPend; S.potPend = null; drawPot(); }
  function drawPot() {
    const p = S.pot; if (!p || typeof p.bal !== 'number') { potb.hidden = true; return; }
    const t = money(p.bal).replace(' chips', ''), prev = potb.dataset.v; potb.innerHTML = `<div class="m"><i></i>POT</div><b class="${t.length > 10 ? 'xs' : t.length > 8 ? 's' : ''}">${t}</b>`;
    if (prev != null && +prev !== p.bal) { potb.classList.add('tick'); setTimeout(() => potb.classList.remove('tick'), 700); } potb.dataset.v = p.bal;
  }
  // warm squares: the lit squares of a quiet board are the warm leads; each shows the bet it was made at (and only while the bet matches)
  function drawWarm() {
    const ovl = CC.board.ovl(); ovl.querySelectorAll('.wst').forEach((n) => n.remove());
    const v = S.view; if (!live() || st().busy || !v || !v.warm || !v.warm.length || v.warmBet !== S.bet) return;
    v.warm.forEach((p) => { const t = el('div', 'wst', `<i>${money(v.warmBet).replace(' chips', '')}</i>`), [x, y] = CC.board.xy(p); t.style.left = x + 'px'; t.style.top = y + 'px'; ovl.appendChild(t); });
  }
  const warnTxt = () => { const v = S.view; if (!v || !v.warm || !v.warm.length || v.warmBet === S.bet) return ''; const n = v.warm.length; return `${n} WARM ${n === 1 ? 'LEAD WORKS' : 'LEADS WORK'} AT ${money(v.warmBet).toUpperCase()} ONLY`; };
  function render() {
    const on = live() && !!S.view; app.classList.toggle('pl-on', on);
    note.hidden = !on; leaf.hidden = !on; potb.hidden = !(on && S.pot);
    if (!on) { feedEl.hidden = true; ribbon.classList.remove('plf'); return; }
    drawNote(); drawLeaf(); drawPot(); drawWarm(); syncCb(); idleRibbon();
  }
  function syncCb() {                                           // the bet readout of a pending Callback: the Callback's own bet, a different label
    const cb = live() && K().cbPending(), m = $('betM'); m.classList.toggle('cb', cb); m.querySelector('.lbl').textContent = cb ? 'FREE BONUS AT' : 'BET';
  }

  // ------------------------------------------------------------------ the rule bar: idle overrides, prompts, the feed
  function ribSet(l, r) { if (!S.rib) S.rib = { l: ribL.textContent, r: ribR.textContent }; ribL.textContent = l; ribR.textContent = r == null ? '' : r; S.mine = { l, r: ribR.textContent }; }
  function ribRestore() { if (!S.rib) return; if (ribL.textContent === S.mine.l) ribL.textContent = S.rib.l; if (ribR.textContent === S.mine.r) ribR.textContent = S.rib.r; S.rib = S.mine = null; }
  function idleRibbon() {
    const v = S.view, can = live() && v && !st().busy && !S.prompt;
    let key = '', l = '', cls = '';
    if (can && v.cb) { key = 'cb' + v.cb.bet; l = 'FREE BONUS AT ' + money(v.cb.bet).toUpperCase(); cls = 'gold'; }
    else if (can && warnTxt()) { key = 'w' + warnTxt(); l = warnTxt(); cls = 'warn'; }
    if (key === S.idleKey) return;
    if (S.idleKey) { ribRestore(); ribbon.classList.remove('gold', 'warn'); }
    S.idleKey = key; if (key) { ribSet(l, ribR.textContent); ribbon.classList.add(cls); }
    feedStep(true);
  }
  const feedLine = (ev) => {
    const who = ev.you ? 'YOU' : String(ev.who || '?').slice(0, 12), a = ev.amount != null ? money(ev.amount) : '';
    const t = ev.kind === 'win' ? 'closed ' + xTxt(ev.x) : ev.kind === 'bonus' ? 'hit ' + (BN[ev.bonus] || 'a bonus') : ev.kind === 'callback' ? 'took a CALLBACK' : ev.kind === 'pot' ? 'took THE POT ' + a : null;
    return t == null ? null : { who, t, you: !!ev.you, mode: ev.mode || null };
  };
  const sameMode = (l) => !l.mode || l.mode === st().mode;
  function feed(ev) {
    if (!ev || !live()) return; if (ev.id != null) { if (S.seen.has(ev.id)) return; S.seen.add(ev.id); }
    const ln = feedLine(ev); if (!ln || !sameMode(ln)) return; S.feed = S.feed.filter(sameMode); S.feed.push(ln); if (S.feed.length > 12) S.feed.shift(); S.fi = S.feed.length - 1; S.phase = 0; feedStep(true);
  }
  function feedStep(now) {                                      // 3 beats of the current line, 1 beat of the usual right-hand text
    const can = live() && S.view && S.feed.length && !st().busy && !S.prompt && !S.idleKey;
    if (S.feed.some((l) => !sameMode(l))) { S.feed = S.feed.filter(sameMode); S.fi = Math.min(S.fi, Math.max(0, S.feed.length - 1)); }
    if (!can) { feedEl.hidden = true; ribbon.classList.remove('plf'); return; }
    if (!now && S.demo) return;                                  // ?mock=pull keeps the line on screen for the shot
    if (!now) { S.phase = (S.phase + 1) % 4; if (S.phase === 0) S.fi = (S.fi + 1) % S.feed.length; }
    if (S.phase === 3 && S.feed.length > 0) { feedEl.hidden = true; ribbon.classList.remove('plf'); return; }
    const ln = S.feed[S.fi]; if (!ln) return;
    feedEl.innerHTML = `<s>${ln.who.replace(/[<>&]/g, '')}</s>${ln.t}`; feedEl.classList.toggle('you', ln.you); feedEl.hidden = false; ribbon.classList.add('plf');
  }
  function feedClear() { S.feed = []; S.seen.clear(); S.fi = 0; S.phase = 0; feedEl.hidden = true; ribbon.classList.remove('plf'); feedStep(true); }   // U9: a mode switch never shows the other currency
  setInterval(() => feedStep(false), 1600);
  setInterval(() => { if (S.view && live()) drawCold(); }, 15000);                // the cold clock runs down on this screen too

  // ------------------------------------------------------------------ prompts (PICK YOUR LEAD / ONE MORE CALL): one at a time, the watchdog closes a stale one
  function openPrompt(kind, ctx) {
    closePrompt(); const P = (S.prompt = { kind, ctx, gone: 0, iv: 0, dispose: null, keys: null, dr: null, armed: false, armT: 0 });
    ribbon.classList.remove('gold', 'warn', 'plf'); feedEl.hidden = true; S.idleKey = ''; ribbon.classList.add('ask');
    ribSet(kind === 'pick' ? 'PICK YOUR LEAD' : 'ONE MORE CALL?', ''); P.iv = setInterval(tick, 100); tick();
    P.armT = setTimeout(() => { P.armed = true; if (P.keys) P.keys.classList.remove('arming'); document.querySelectorAll('.slots i.pl-arm').forEach((n) => n.classList.remove('pl-arm')); }, ARM_MS); return P;
  }
  function tick() {
    const P = S.prompt; if (!P) return; const c = P.ctx, t = c.timer, left = t.left(), total = t.timeoutMs || 20000, f = Math.max(0, Math.min(1, left / total)), s = Math.ceil(left / 1000);
    ribbon.style.setProperty('--left', (f * 100).toFixed(1) + '%'); ribbon.classList.toggle('late', left < 5000 && left > 0);
    ribR.textContent = Math.floor(s / 60) + ':' + pad2(s % 60); S.mine = { l: S.mine ? S.mine.l : ribL.textContent, r: ribR.textContent };
    if (P.dr) { P.dr.firstChild.style.setProperty('--w', (f * 100).toFixed(1) + '%'); P.dr.classList.toggle('late', left < 5000 && left > 0); }
    if (P.kind === 'pick') document.querySelectorAll('.slots i.pick').forEach((n) => { n.classList.toggle('pl-late', left < 5000); if (!P.armed) n.classList.add('pl-arm'); });
    const s0 = st(); if (!s0.ctx || s0.ctx !== c || !c.promptOpen) { if (++P.gone > 4) closePrompt(); } else P.gone = 0;   // the round went away under the prompt (voided, refused, settled): clean up
  }
  function closePrompt() {
    const P = S.prompt; if (!P) return; S.prompt = null; clearInterval(P.iv); clearTimeout(P.armT); if (P.dispose) P.dispose();
    if (P.keys) P.keys.remove(); hud.classList.remove('dec'); ribbon.classList.remove('ask', 'late'); ribbon.style.removeProperty('--left');
    document.querySelectorAll('.slots i.pl-late, .slots i.pl-arm').forEach((n) => n.classList.remove('pl-late', 'pl-arm')); ribRestore(); idleRibbon();
  }
  function askPick(pend, ctx) {
    return new Promise((res) => {
      const P = openPrompt('pick', ctx); let done = false;
      P.dispose = ctx.pickTargets(pend.choices, (p) => { if (done || !P.armed) return; done = true; closePrompt(); res(p); });   // U1: a tap inside the arming window is swallowed (board.js eats it, nothing is picked, nothing skips)
      tick();
    });
  }
  // U2: the three numbers are the ROUND's outcomes. base = what the trigger spin already paid (the WIN meter minus the bonus W); it stays in every outcome.
  function moreFigures(pend, ctx) {
    const runT = ctx.run && typeof ctx.run.t === 'number' ? ctx.run.t : pend.W, baseT = Math.max(0, runT - pend.W);
    return { baseT, bank: ctx.cents(baseT + pend.W), win: ctx.cents(baseT + pend.W * pend.mult), lose: ctx.cents(baseT), bonus: ctx.cents(pend.W), base: ctx.cents(baseT) };
  }
  function askMore(pend, ctx) {
    return new Promise((res) => {
      const P = openPrompt('more', ctx), F = moreFigures(pend, ctx), paid = F.baseT > 0, [pw, pl] = pct2(pend.pWin), dbl = pend.mult === 2 ? 'double' : 'x' + pend.mult;
      const mb = money(F.bank), mw = money(F.win), ml = money(F.lose), long = Math.max(mb.length, mw.length, ml.length);
      const lines = paid
        ? `<span><b>${pw}%</b> ${dbl} the bonus: ${mw}</span><span><b>${pl}%</b> lose the bonus: ${ml}</span>`
        : `<span><b>${pw}%</b> you ${dbl} (${mw}).</span><span><b>${pl}%</b> you leave with ${ml}.</span>`;
      const keys = el('div', 'dec2 arming' + (long > 17 ? ' xs' : long > 12 ? ' s' : ''), `<div class="dr"><i></i></div>
        <div class="bon" aria-hidden="true"><small>THE BONUS</small><b>${money(F.bonus)}</b>${paid ? `<em>+ ${money(F.base)} already won</em>` : ''}</div>
        <button class="k hang" id="pl_bank"><b>HANG UP</b><em>${paid ? 'bank ' : 'BANK '}${mb}</em><small>keep it</small></button>
        <button class="k more" id="pl_more"><b>ONE MORE CALL</b>${lines}</button>`);
      P.keys = keys; P.dr = keys.querySelector('.dr'); hud.insertBefore(keys, hud.firstChild); hud.classList.add('dec');
      let done = false; const go = (take) => (e) => { e.preventDefault(); if (done || !P.armed) return; done = true; keys.querySelectorAll('button').forEach((b) => { b.disabled = true; }); closePrompt(); res(take); };   // U1: inert until armed
      keys.querySelector('#pl_bank').addEventListener('click', go(false)); keys.querySelector('#pl_more').addEventListener('click', go(true));
      tick();
    });
  }
  function timer() { tick(); }                                      // a g:coldcall:timer re-synced ctx.timer: redraw now
  function expired(why, info) {                                     // the server decided: "TIME'S UP: <default>" stays on the bar for a moment
    const had = !!S.prompt; closePrompt(); if (!had && why == null) return;
    const d = info && info.default ? String(info.default).toUpperCase() : ''; ribSet("TIME'S UP", d); setTimeout(() => { if (S.mine && S.mine.l === "TIME'S UP") ribRestore(); idleRibbon(); }, 1800);
  }

  // ------------------------------------------------------------------ banners in the head band (lead gain, daily, cold)
  async function banner(title, text, ms, ctx) {
    const my = ++S.bn; bn.innerHTML = `<b>${title}</b>${text}`; bn.hidden = false; head.classList.add('plbn');
    if (!reduce) bn.animate([{ transform: 'scale(.4) rotate(-10deg)', opacity: 0 }, { transform: 'scale(1.06) rotate(0)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
    await (ctx && ctx.wait ? ctx.wait(ms) : new Promise((r) => setTimeout(r, ms)));
    if (my === S.bn) { bn.hidden = true; head.classList.remove('plbn'); }
  }
  async function leadGain(p) {                                      // after a round: leads filled, daily claim, cold leak, Callback armed
    if (!p || !live() || !S.view) return; const k = K(), v = S.view, list = v.list || 1, from = Math.floor((p.leadsBefore || 0) / 10), to = Math.floor((p.leadsAfter != null ? p.leadsAfter : (p.leadsBefore || 0)) / 10);
    const steps = [], my = ++S.lg;                                  // (chris 10-06 FB1) game.js no longer waits for this (only a Callback announcement holds SPIN): a newer call supersedes an older one, only the newest touches the note
    gain.hidden = true;
    if (p.leaked > 0) steps.push(['WENT COLD', `${ldTxt(p.leaked / 10)} went cold while you were away.`]);
    if (p.daily) steps.push(['APPOINTMENT', `+${ldTxt(p.daily.leads)}, day ${p.daily.streak} kept.`]);
    if (p.armed) steps.push(['CALLBACK!', 'Your list is full. The next call is free.']);
    if (p.filled > 0) {
      const f = +(p.filled / 10).toFixed(1); gain.textContent = '+' + f + (f === 1 ? ' LEAD' : ' LEADS'); gain.hidden = false; note.classList.remove('hit'); void note.offsetWidth; note.classList.add('hit');
      drawNote(from);                                               // (chris 10-06 FB1) the count starts on this call's own number now, not on the next frame: with frames starved a superseded call's last number stayed up (fb1 driver, 26 of 81 samples)
      k.tween(from, Math.max(from, to), 600, (x) => { if (my === S.lg) drawNote(Math.round(x)); });
    }
    for (const [t, tx] of steps) await banner(t, tx, 1200, k);
    if (!steps.length) await k.wait(700);
    if (my === S.lg) { gain.hidden = true; drawNote(); }
  }

  // ------------------------------------------------------------------ GHOST: "WOULD HAVE CLOSED $12.40", a stamped sticky in the head band; the squares flip, nothing is added to the win
  // (chris 10-06 FB1) the ghost never holds SPIN: game.js starts it AFTER the round is settled and the button is free; play() / a bet change end it with endGhost(); every await checks G.dead
  function endGhost() {
    const G = S.gh; if (!G) return false; S.gh = null; G.dead = true; if (G.stamp) G.stamp.remove(); head.classList.remove('plg'); G.nodes.forEach((n) => n.remove());
    G.leads.forEach((p) => { const s = $('slots').children[p]; if (s) s.classList.remove('plg'); const sq = CC.board.el(p); if (sq) sq.classList.remove('under'); }); CC.board.setHot([]); return true;
  }
  async function ghost(g, ctx) {
    const ph = g && g.script, gr = rulesOf().ghost; if (!ph || !(g.pay > 0) || !live() || (gr && gr.minTenths > g.pay)) return;   // only at the knob's minTenths (50 = 5x)
    const B = CC.board, ovl = B.ovl(), k = K(), amt = ctx.cents(g.pay), nodes = [];
    const TN = ['quote_bronze', 'quote_silver', 'quote_gold'], fin = new Map();
    for (const rd of ph.rounds) {
      for (const r of rd.reveals) fin.set(r.p, { k: r.k, v: r.v, t: r.t });
      for (const u of rd.upsells) for (const h of u.hits) { const f = fin.get(h.p); if (f && (f.k === 'b' || (f.k === 'c' && !h.pend))) f.v = h.after; }   // every hit counts: an upsell on a close that already collected multiplies it (U10)
      for (const c of rd.collects) { const f = fin.get(c.p); if (f) f.v = c.value; }
    }
    endGhost(); const G = (S.gh = { dead: false, nodes, leads: ph.leads, stamp: null });
    head.classList.add('plg'); B.setHot(ph.leads); await ctx.wait(380); if (G.dead) return;
    ph.leads.forEach((p) => { const s = $('slots').children[p]; if (s) s.classList.add('plg'); });
    let i = 0;
    for (const [p, f] of fin) {
      const [x, y] = B.xy(p), n = el('div', 'rv ' + (f.k === 'b' ? 'b t' + f.t : f.k === 'u' ? 'u' : 'c') + ' ghostrv');
      if (f.k === 'b') { n.append(CC.assets.img(TN[f.t], 'bub')); const a = el('span', 'amt'); const s = CC.phone.amt(ctx.cents(f.v)); a.textContent = s; a.dataset.l = s.length > 5 ? 6 : s.length; n.append(a); }
      else if (f.k === 'u') n.innerHTML = '<b>x' + f.v + '</b><i>UPSELL</i>';
      else { const s = CC.phone.amt(ctx.cents(f.v)); n.innerHTML = `<span class="cm"></span><span class="cv" data-l="${s.length > 5 ? 6 : s.length}">${s}</span><em class="mx"></em>`; }
      n.style.left = x + 'px'; n.style.top = y + 'px'; ovl.appendChild(n); nodes.push(n);
      const sq = B.el(p); if (sq) sq.classList.add('under');
      if (!reduce) n.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1.12)', offset: 0.65 }, { transform: 'scaleX(1)' }], { duration: 230 * k.speed(), delay: i * 60 * k.speed(), fill: 'backwards', easing: 'ease-out' }); i++;
    }
    await ctx.wait(i * 60 + 300); if (G.dead) return;
    const a = money(amt), mx = xTxt(g.pay / 10), stamp = el('div', 'stamp plgh', `<div class="t">IF A PHONE HAD LANDED</div><div class="v">${mx}</div><small>${a.length > 12 ? 'times your bet' : a + ' at your bet'}<br>Not paid.</small>`);
    head.appendChild(stamp); G.stamp = stamp; ctx.SFX.stamp && ctx.SFX.stamp(); ctx.CC_ghost = true;
    if (!reduce) stamp.animate([{ transform: 'scale(2.2) rotate(-12deg)', opacity: 0 }, { transform: 'scale(.94)', opacity: 1, offset: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 300 * k.speed(), easing: 'ease-out' });
    if (ctx.demoHold) await hold(ctx, 0); else await Promise.race([ctx.waitTap(2400), ctx.wait(2600)]);
    if (S.gh === G) endGhost();
  }

  // ------------------------------------------------------------------ ONE MORE CALL taken: the reveal. The WIN meter then moves to the server's final total (game.js).
  async function moreOutcome(m, ctx) {
    if (!m || !m.take) return; const total = money(ctx.cents(ctx.p.totalWinTenths)), won = !!m.won;
    const card = el('div', won ? '' : 'lost', won ? `<b>YOU DOUBLED IT</b><em>${total}</em><span>x${m.mult} on the bonus. Round total.</span>` : `<b>NO DEAL</b><em>${total}</em><span>x${m.mult} missed: the bonus is gone. Round total.</span>`, 'plmo');
    scene.appendChild(card); won ? ctx.SFX.win(2) : ctx.SFX.sting(); CC.hero.mood(won ? 'win' : 'shock', 2000); if (won) { ctx.FX.coins(30); ctx.FX.ring(270, 430, { n: 2, r1: 160 }); }
    if (!reduce) card.animate([{ transform: 'scale(.3) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1.06) rotate(-2.5deg)', opacity: 1, offset: 0.6 }, { transform: 'rotate(-2.5deg)', opacity: 1 }], { duration: 320 * K().speed(), easing: 'ease-out' });
    await hold(ctx, 1800); card.remove();
  }

  // ------------------------------------------------------------------ the office pot: a medallion over the board, the amount is ADDED on top of the win
  async function potWin(pot, ctx) {
    if (!pot || !pot.won) return; const amt = pot.amount, t = money(amt).replace(' chips', ''), cap = E.MAX_WIN_X.toLocaleString('en-US') + 'x';
    const box = el('div', '', `<i class="cw l"></i><i class="mug"></i><small>THE OFFICE POT</small><b>YOU TOOK IT</b><em class="${t.length > 9 ? 's' : ''}">${money(0).replace(' chips', '')}</em><span>${chips() ? 'chips ' : ''}on top of your win. Outside the ${cap} cap.</span><i class="cw r"></i>`, 'plpot');
    scene.appendChild(box); ctx.SFX.win(3); ctx.SFX.big && ctx.SFX.big(3); CC.hero.set('win', 2800); ctx.FX.flash(140, '#fff', 0.5); ctx.FX.coins(70); ctx.FX.confetti(30); ctx.FX.ring(270, 430, { n: 3, r1: 200 });
    if (!reduce) box.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 380 * K().speed(), easing: 'ease-out' });
    const e = box.querySelector('em'); await ctx.tween(0, amt, 1100, (v) => { e.textContent = money(Math.round(v)).replace(' chips', ''); }); e.textContent = t;
    if (ctx.demoHold) await hold(ctx, 0); else await Promise.race([ctx.waitTap(3200), ctx.wait(3400)]);
    box.remove(); S.potDone = true; potFlush();
  }

  // ------------------------------------------------------------------ info screen: one honest line per mechanic, numbers from the rules, plus the pot odds
  function infoLines() {
    const R = rulesOf(), h = (ms) => String(+(ms / 3600000).toFixed(1)), ln = [], f = R.fill || {}, cap = E.MAX_WIN_X.toLocaleString('en-US') + 'x';
    const dollar = (c) => (chips() ? num(c) + ' chips' : '$' + (c / 100).toFixed(c % 100 ? 2 : 0));
    ln.push(['Leads.', `Every paid base spin adds leads to your list: ${f.dead} on a spin that paid nothing, ${f.win} on a win, ${f.bonus} when it triggers a bonus. Bought bonuses add none.`]);
    if (R.callback) ln.push(['The Callback.', `Fill the list (${R.list} leads) and THE CALLBACK arms: a free ${BN[R.callback.kind] || ''} bonus played at the average bet your leads came from${R.carryOver ? '. Leads over the list size carry over' : ''}.`]);
    if (R.cold) ln.push(['Going cold.', `Stay away ${h(R.cold.afterMs)} h and leads go cold: ${R.cold.batch} every ${h(R.cold.stepMs)} h, never below ${R.cold.floor}. Warm squares die at the first cold event.`]);
    if (R.warm) ln.push(['Warm leads.', `A spin that ends with lit squares and no phone keeps each one with a ${+(R.warm.chance * 100).toFixed(1)}% chance, up to ${R.warm.cap}. A warm square is lit at the bet it was made at: any other bet drops them.`]);
    if (R.ghost && R.ghost.on) ln.push(['If a phone had landed.', `On a spin that paid under ${xTxt(R.ghost.maxWinTenths / 10)} with lit squares and no phone, the stamp shows what the call you did not get would have paid, only when that is ${xTxt(R.ghost.minTenths / 10)} or more. It is a draw, not a promise, and it is never added to your win.`]);
    if (R.pick && R.pick.on) { const m = R.pick.mult || {}; ln.push(['Pick your lead.', `At the first phone of a bonus, if ${R.pick.minLeads} or more leads are lit, you pick one. Its call is drawn with the odds multiplied: bronze x${m.bronze}, silver x${m.silver}, gold x${m.gold}, upsell x${m.upsell}, close x${m.close}. ${Math.round((R.decision ? R.decision.timeoutMs : 20000) / 1000)} seconds, then it picks the first lead.`]); }
    if (R.more && R.more.on) ln.push(['One more call.', `After a bonus paying ${+(R.more.minTenths / 10).toFixed(1)}x or more you can bank it, or call once more: ${pct2(R.more.rtp / R.more.mult)[0]}% you win ${R.more.mult}x the bonus, ${pct2(R.more.rtp / R.more.mult)[1]}% you get ${dollar(0)}. ${R.more.rtp === 1 ? 'A fair coin: it does not change the payback. ' : ''}The bank, double and lose figures are the whole round: what the spin that triggered the bonus already paid stays yours. Not offered when the double would pass the cap. Wait too long and you bank.`]);
    if (R.daily) ln.push(['The appointment.', `Your first paid spin each day keeps your appointment: ${ldTxt(R.daily.base)} free, +${+Number(R.daily.perStreak).toFixed(2)} for each day in a row, up to ${ldTxt(R.daily.base + R.daily.perStreak * R.daily.streakMax)}. They count at your bet or ${dollar(R.daily.stakeCap)}, whichever is lower.`]);
    if (R.pot) {
      const o = R.pot.oneInPerDollar, hit = o > 0 ? `each spin has a 1 in ${num(o)} chance per ${chips() ? '100 chips' : '$1'} bet of taking all of it, up to ${num(R.pot.maxPayX)}x your bet` : 'no one can take it right now';
      ln.push(['The office pot.', `${+(R.pot.feedBps / 100).toFixed(2)}% of every paid bet goes in; ${hit}${R.pot.minBal > 0 ? `; a pot under ${dollar(R.pot.minBal)} pays nothing yet` : ''}. Play $ and Chips have separate pots. The pot is extra: it is paid on top of your win, outside the ${cap} cap.`]);
    }
    return ln;
  }
  const rules = (r) => { if (r && typeof r === 'object') S.rules = r; };
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      const c = n.nodeType === 1 && n.querySelector && n.querySelector('.card.info'); if (!c || c.querySelector('.plinfo') || !live()) continue;
      const box = el('div', 'plinfo', '<p class="tl">The pull</p>' + infoLines().map(([a, b]) => `<p><b>${a}</b> ${b}</p>`).join('')), tl = c.querySelector('p.tl'); if (tl) c.insertBefore(box, tl); else c.insertBefore(box, c.lastElementChild);
    }
  }).observe($('ov'), { childList: true });

  // ------------------------------------------------------------------ the API game.js calls
  function setView(view, mode) {
    if (!view) return; S.view = view; S.mode = mode || S.mode; S.bet = betNow(); render();
  }
  function setPot(p) {
    if (!p) return; if ((S.potPend || (S.pot && typeof p.bal === 'number' && p.bal < S.pot.bal)) && potHeld()) { S.potPend = p; return; }
    S.potPend = null; S.pot = p; drawPot(); potb.hidden = !(live() && S.view);
  }
  function onBetChange(b) { endGhost(); S.bet = b != null ? b : betNow(); drawWarm(); idleRibbon(); }
  new MutationObserver(() => {                                      // the SPIN button class is the busy flag; the spin button's .cb is the Callback flag
    const busy = st().busy; app.classList.toggle('pl-busy', busy); syncCb(); if (!busy) { S.potDone = false; potFlush(); }
    if (busy) { S.view && drawWarmOff(); ribbon.classList.remove('gold', 'warn'); if (S.idleKey) { ribRestore(); S.idleKey = ''; } feedStep(true); } else if (S.view) { drawWarm(); idleRibbon(); }
  }).observe($('spin'), { attributes: true, attributeFilter: ['class'] });
  const drawWarmOff = () => CC.board.ovl().querySelectorAll('.wst').forEach((n) => n.remove());

  // ------------------------------------------------------------------ ?mock=pull: every state without a server
  async function demo(state = 'idle', mode = 'play') {
    const k = K(); while (!CC.ready) await new Promise((r) => setTimeout(r, 50)); S.demo = true; if (S.hold) { const r = S.hold; S.hold = null; r(); }
    closePrompt(); k.sweep(); bn.hidden = true; head.classList.remove('plg', 'plbn'); document.querySelectorAll('#head > .stamp').forEach((n) => n.remove());
    const s = k.st, bet = +Q.get('bet') || 100; s.live = true; s.mode = mode; s.me = 'YOU'; s.busy = false; s.betIdx = Math.max(0, s.bets.indexOf(bet)); s.cbBet = null;
    k.applyWallet({ play: 100000, chips: 100000 }); document.querySelector(`#modebar [data-m="${mode}"]`).click(); $('spin').classList.remove('run'); $('spin').classList.add('idle'); s.ctx = null;
    const L = rulesOf().list, cold = { inMs: 3 * 3600e3 + 12 * 60e3, leads: Math.floor(rulesOf().cold.batch), warm: 4 };
    const view = { leads: state === 'callback' ? L : 312, lt: state === 'callback' ? L * 10 : 3125, list: L, cb: state === 'callback' ? { bet: 200 } : null, warm: state === 'callback' ? [] : [3, 8, 19, 26], warmBet: bet, cold, daily: { claimed: false, streak: 3, next: 0.3 }, at: Date.now() };
    s.pv[mode] = view; s.pot[mode] = { bal: 128450, last: null }; S.rules = null; S.feed = []; S.seen.clear(); S.phase = 0;
    const ids = (n) => n.map((x) => Math.max(0, E.SYM.indexOf(x)));
    const G = { idle: ['headset', 'pile', 'closer', 'note', 'cash', 'can', 'cups', 'mug', 'ball', 'rx', 'pile', 'note', 'cash', 'headset', 'pile', 'can', 'cups', 'cash', 'note', 'mug', 'headset', 'rx', 'cashwad', 'pile', 'can', 'cups', 'pile', 'headset', 'note', 'cash'],
      bonus: ['can', 'pile', 'mug', 'headset', 'cash', 'cups', 'closer', 'phone', 'pile', 'note', 'ball', 'rx', 'cups', 'headset', 'phone', 'mug', 'can', 'pile', 'pile', 'cash', 'headset', 'phone', 'closer', 'note', 'mug', 'can', 'cups', 'pile', 'headset', 'cash'],
      dead: ['mug', 'pile', 'can', 'headset', 'cups', 'rx', 'closer', 'headset', 'note', 'pile', 'mug', 'can', 'cups', 'can', 'cash', 'closer', 'headset', 'pile', 'rx', 'pile', 'mug', 'note', 'can', 'cups', 'headset', 'closer', 'pile', 'cups', 'rx', 'mug'] };
    const bonus = state === 'pick' || state === 'more';
    CC.board.show(ids(bonus ? G.bonus : state === 'ghost' ? G.dead : G.idle)); CC.board.setHot(bonus || state === 'ghost' || state === 'pot' ? [] : view.warm, true);
    s.bets.length || (s.bets = E.BET_LEVELS.slice());
    const ctx = { bet, cents: (t) => t * bet / 10, dollars: k.dollars, wait: k.wait, tween: k.tween, speed: k.speed, SFX: k.SFX, FX: CC.fx, say: k.say, stamp: k.stamp, waitTap: k.waitTap, timer: { timeoutMs: 20000, expiresAt: Date.now() + 14000, left() { return Math.max(0, this.expiresAt - Date.now()); } },
      pickTargets: (c, cb) => CC.board.pickTargets(c, cb), run: { t: state === 'pick' ? 112 : (+Q.get('W') || 358.4) + (+Q.get('base') || 0) }, demoHold: true, promptOpen: null, p: { totalWinTenths: state === 'more_lost' ? 0 : 717, status: 'done' } };
    k.syncView(); render();
    $('win').dataset.c = 0; k.setWin(0, false);
    if (state === 'callback') { k.say('idle'); k.SFX.stamp; }
    if (state === 'idle' || state === 'callback') {
      [['MATT', 'win', 2400], ['DANI', 'callback', 0], ['YOU', 'win', 37]].forEach(([w, kd, x], i) => feed({ id: 9000 + i, kind: kd, who: w, x, amount: 0, mode, you: w === 'YOU' })); feed({ id: 9100, kind: 'win', who: 'MATT', x: 2400, mode }); S.phase = 0; feedStep(true);
    }
    if (state === 'pick' || state === 'more') {
      document.getElementById('stage').classList.add('bonus'); $('bh').hidden = false; $('bhLeft').textContent = state === 'pick' ? 7 : 0; $('bhTot').textContent = state === 'pick' ? k.dollars(1120) : k.dollars(3584);
      k.setWin(state === 'pick' ? 1120 : 3584, false); ctx.promptOpen = state; s.ctx = ctx; s.busy = true; $('spin').classList.add('run'); $('spin').classList.remove('idle'); app.classList.add('pl-busy');
      if (state === 'pick') { CC.board.setHot([7, 14, 21], true); k.say('idle'); askPick({ choices: [7, 14, 21] }, ctx).then(() => {}); }
      else { CC.hero.mood('hype'); askMore({ W: +Q.get('W') || 358.4, mult: 2, pWin: 0.5 }, ctx).then(() => {}); }
    }
    if (state === 'ghost') {
      s.busy = true; app.classList.add('pl-busy'); CC.hero.mood('shock'); k.setWin(0, false);
      const g = { pay: 124, closes: 0, leads: 3, script: { leads: [4, 13, 22], pay: 124, rounds: [{ reveals: [{ p: 4, k: 'b', v: 22, t: 0 }, { p: 13, k: 'b', v: 68, t: 1 }, { p: 22, k: 'b', v: 34, t: 2 }], upsells: [], collects: [] }] } };
      ghost(g, ctx);
    }
    if (state === 'pot') { s.busy = true; app.classList.add('pl-busy'); k.setWin(3700, false); potWin({ won: true, amount: 128450, who: 'YOU' }, ctx); }
    if (state === 'gain') leadGain({ leadsBefore: 3120, leadsAfter: 3245, filled: 12, daily: { leads: 0.3, streak: 4 }, leaked: 0, armed: false });
    if (state === 'more_won' || state === 'more_lost') { s.busy = true; app.classList.add('pl-busy'); moreOutcome({ take: true, won: state === 'more_won', mult: 2 }, ctx); }
    await new Promise((r) => setTimeout(r, 450));
  }
  const release = () => { if (S.hold) { const r = S.hold; S.hold = null; r(); } };

  const armed = () => !!(S.prompt && S.prompt.armed);                 // true once the open prompt takes taps (false: no prompt, or still inside the 600 ms arming window)
  CC.pull = { armed, feedClear, setView, setPot, feed, onBetChange, leadGain, ghost, endGhost, askPick, askMore, expired, moreOutcome, potWin, rules, timer, infoLines, demo, release, _S: S };
  if (Q.get('mock') === 'pull') { window.demo = demo; demo(Q.get('state') || 'idle', Q.get('mode') || 'play'); }
})();
