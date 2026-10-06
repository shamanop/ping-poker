// In-page scene scripts (evaluated after the game is ready). Each scene returns { win: [[name, t0, t1], ...], ph: {...}, info: {...} } in performance.now() ms.
// Frame time is only read from the windows in `win`, never from setup or from waiting between scenes. All input is in-page (no Playwright click delay).
// An "auto player" taps through the cards a player would tap (big-win card, BONUS COMPLETE, the dial / keypad) after holding them for HOLD ms.
(() => {
  const CC = window.CC, st = CC.core.st, $ = (id) => document.getElementById(id), now = () => performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (n) => { try { performance.mark('fb5:' + n); } catch (e) {} return now(); };
  const HOLD = 1500;
  const until = async (fn, ms, what, adv) => { const t0 = now(); while (!fn()) { if (adv) adv(); if (now() - t0 > ms) throw new Error('timeout ' + ms + ' ms waiting for ' + what); await sleep(20); } };
  // taps / finishes whatever is waiting for the player once it has been on screen for HOLD ms
  function auto(extra) {
    const seen = {}; let n = 0;
    const once = (k, el, act) => { if (!el) { seen[k] = 0; return; } if (!seen[k]) seen[k] = now(); if (seen[k] > 0 && now() - seen[k] > HOLD) { seen[k] = -1; n++; act(el); } };
    return () => {
      once('tier', $('tier'), () => { st.tap++; });
      once('dial', document.querySelector('.scn.rot'), (el) => { const d = el.querySelector('.dial'); if (d && d._finish) d._finish(); else { for (const k of ['5', 'Enter']) dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === 'Enter' ? 'Enter' : 'Digit' + k, bubbles: true })); } });
      once('tapcard', document.querySelector('.scn .tap'), () => { st.tap++; });
      once('splashgo', $('splash') && !$('go').disabled ? $('go') : null, (b) => b.click());
      if (extra) extra();
    };
  }
  const roundDone = (adv, ms = 180000) => until(() => !st.busy, ms, 'round end (st.busy false)', adv);
  const lastRound = () => { const r = (CC.dbg && CC.dbg.rounds) || []; const x = r[r.length - 1] || {}; return { kind: x.kind, bonus: x.bonus, tier: x.tier, win: x.win, cascades: undefined, forced: x.forced }; };
  const click = async (id) => { await until(() => !st.busy && !st.modal, 60000, id + ' idle'); await sleep(300); const t0 = mk('spin'); $(id).click(); await until(() => st.busy, 2000, 'busy after click'); return t0; };

  const S = {};
  // idle 10 s: no input, splash gone, hero idle + room props + leads strip as they are
  S.idle = async () => { await sleep(200); const t0 = mk('idle0'); await sleep(10000); return { win: [['idle 10 s', t0, mk('idle1')]] }; };
  // 10 normal spins (not forced): per-spin windows (click -> SPIN accepting again); the union of them is the scene
  S.spins10 = async () => {
    const win = [], rows = [], adv = auto();
    for (let i = 0; i < 10; i++) { const t0 = await click('spin'); await roundDone(adv); const t1 = mk('spin_end'); win.push(['spin ' + (i + 1), t0, t1]); rows.push({ i: i + 1, ms: Math.round(t1 - t0), ...lastRound() }); }
    return { win, group: '10 normal spins', info: { rows } };
  };
  // practice rounds are seeded from crypto.getRandomValues (one Uint32); __fb5.queue hands the next round a seed chosen offline with the same engine, so these scenes are the same round on every run
  const E = window.ColdCallEngine;
  const pickSeed = (pred) => { for (let sd = 1; sd < 60000; sd++) { const q = E.resolveRound(E.rngFrom(sd), null), sp = q.script.spin; if (pred(q, sp)) return { seed: sd, tier: q.tier, winX: q.winX, steps: sp.steps.length }; } throw new Error('no seed found'); };
  // a plain cascade win: 3+ cascade steps, no bonus (x2-3 tier), click -> SPIN accepting again
  S.cascade = async () => {
    const adv = auto(), pk = pickSeed((q, sp) => !q.script.bonus && q.winTenths > 0 && sp.steps.length >= 4 && !sp.phone); __fb5.queue.push(pk.seed);
    const t0 = await click('spin'); await roundDone(adv); return { win: [['cascade win (' + pk.steps + ' cascades, x' + pk.winX + ')', t0, mk('casc_end')]], info: { ...pk, ...lastRound() } };
  };
  // a big win without a bonus: click -> big-win card, then the card held 3 s
  S.bigwin = async () => {
    const adv = auto(), pk = pickSeed((q, sp) => !q.script.bonus && ['big', 'huge', 'mega', 'legend'].includes(q.tier) && sp.steps.length >= 2); __fb5.queue.push(pk.seed);
    const t0 = await click('spin'); await until(() => $('tier') || !st.busy, 120000, 'big-win card'); const t1 = mk('tier_up'); const win = [['big win: click -> big-win card (' + pk.tier + ' x' + pk.winX + ', ' + pk.steps + ' cascades)', t0, t1]];
    if ($('tier')) { await sleep(3000); win.push(['big-win card held 3 s', t1, mk('tier_held')]); }
    await roundDone(adv); return { win, info: { ...pk, ...lastRound() } };
  };
  // bonus intro (force=bonus1 on the page): base spin that lands 3 bells, BONUS! flourish, PLACE THE CALL until the dial / keypad is done
  S.intro = async () => {
    const adv = auto(), ph = {}; const t0 = await click('spin');
    await until(() => document.querySelector('#head .stamp, .scn.rot'), 60000, 'BONUS! stamp or intro', null); ph.trigger = mk('trigger');
    await until(() => document.querySelector('.scn.rot'), 30000, 'intro scene', null); ph.introStart = mk('intro0');
    await until(() => !document.querySelector('.scn.rot'), 60000, 'intro end', adv); ph.introEnd = mk('intro1');
    const win = [['base spin to the BONUS! stamp', t0, ph.trigger], ['bonus trigger flourish', ph.trigger, ph.introStart], ['bonus intro (PLACE THE CALL)', ph.introStart, ph.introEnd]];
    await roundDone(adv); return { win, ph };
  };
  // buy menu open 3 s, then a full bought bonus (buy menu -> confirm -> intro -> free spins -> end card -> SPIN accepting)
  S.bought = async () => {
    const adv = auto(), ph = {}; await until(() => !st.busy, 30000, 'idle'); await sleep(300);
    $('buy').click(); await until(() => $('buy_bonus1'), 5000, 'buy menu'); const m0 = mk('menu0'); await sleep(3000); const m1 = mk('menu1');
    $('buy_bonus1').click(); await until(() => $('buy_confirm'), 5000, 'confirm'); await sleep(1200);
    const t0 = mk('buy'); $('buy_confirm').click(); await until(() => st.busy, 3000, 'busy after confirm');
    const poll = setInterval(() => { const sg = $('stage').classList.contains('bonus'), sc = !!document.querySelector('.scn.rot'); if (sc && !ph.introStart) ph.introStart = mk('intro0'); if (!sc && ph.introStart && !ph.introEnd) ph.introEnd = mk('intro1'); if (sg && !ph.bonusOn) ph.bonusOn = mk('bonusOn'); if (!sg && ph.bonusOn && !ph.bonusOff) ph.bonusOff = mk('bonusOff'); }, 20);
    try { await roundDone(adv, 300000); } finally { clearInterval(poll); }
    const t1 = mk('bought_end'), win = [['buy menu open 3 s', m0, m1], ['full bought bonus (confirm -> SPIN accepting)', t0, t1]];
    if (ph.introStart && ph.introEnd) win.push(['  bonus intro', ph.introStart, ph.introEnd]);
    if (ph.bonusOn && ph.bonusOff) win.push(['  free spins (stage.bonus)', ph.bonusOn, ph.bonusOff]);
    if (ph.bonusOff) win.push(['  finale (card, BONUS COMPLETE)', ph.bonusOff, t1]);
    return { win, ph, info: lastRound(), group: 'full bought bonus' };
  };
  // mock=pull prompts: hold 8 s from the moment the prompt takes taps
  const prompt = (name) => async () => { await until(() => CC.pull && CC.pull.armed && CC.pull.armed(), 20000, name + ' prompt armed'); await sleep(200); const t0 = mk('p0'); await sleep(8000); return { win: [[name, t0, mk('p1')]] }; };
  S.more = prompt('ONE MORE CALL prompt 8 s');
  S.pick = prompt('PICK YOUR LEAD prompt 8 s');
  S.pullIdle = async () => { await sleep(1200); const t0 = mk('p0'); await sleep(8000); return { win: [['leads strip + feed (mock idle) 8 s', t0, mk('p1')]] }; };
  S.info = async () => { await until(() => document.querySelector('.card.info'), 10000, 'info card'); await sleep(500); const t0 = mk('i0'); await sleep(5000); return { win: [['info screen 5 s', t0, mk('i1')]] }; };

  // ---- survey: expensive style, running animations, image use (taken between windows, never inside one)
  const sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = [...e.classList].slice(0, 3).join('.'); if (c) s += '.' + c; return s; };
  const urlOf = (v) => { const m = /url\(["']?([^"')]+)["']?\)/g; const o = []; let x; while ((x = m.exec(v))) o.push(x[1]); return o; };
  const COMPOSITOR_OK = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity', 'filter', 'backdrop-filter']);
  function survey(tag) {
    const vw = innerWidth, vh = innerHeight, out = { tag, vw, vh, dpr: devicePixelRatio, nodes: 0, styled: [], anims: [], imgs: [] };
    for (const e of document.querySelectorAll('body *')) {
      out.nodes++; const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)), area = w * h;
      const f = cs.filter !== 'none' ? cs.filter : '', bf = (cs.backdropFilter && cs.backdropFilter !== 'none') ? cs.backdropFilter : '', wc = cs.willChange !== 'auto' ? cs.willChange : '', bm = cs.mixBlendMode !== 'normal' ? cs.mixBlendMode : '',
        bs = cs.boxShadow !== 'none' ? cs.boxShadow : '', ts = cs.textShadow !== 'none' ? cs.textShadow : '', mk_ = (cs.maskImage && cs.maskImage !== 'none') ? 'mask' : '', cp = cs.clipPath !== 'none' ? 'clip-path' : '';
      if (f || bf || wc || bm || bs || ts || mk_ || cp) out.styled.push({ sel: sel(e), area: Math.round(area), rect: [Math.round(r.width), Math.round(r.height)], filter: f.slice(0, 80), backdrop: bf.slice(0, 80), willChange: wc, blend: bm, boxShadow: bs.slice(0, 120), textShadow: ts.slice(0, 60), mask: mk_, clip: cp, opacity: cs.opacity !== '1' ? cs.opacity : '' });
      if (e.tagName === 'IMG' && e.currentSrc) out.imgs.push({ url: e.currentSrc, kind: 'img', sel: sel(e), w: r.width, h: r.height, nw: e.naturalWidth, nh: e.naturalHeight });
      const nat = (u) => { const im = CC.assets && CC.assets.imgs && CC.assets.imgs.get(u); return im ? [im.naturalWidth, im.naturalHeight] : [0, 0]; };
      for (const u of urlOf(cs.backgroundImage)) { const a = new URL(u, location.href).href, n = nat(a); out.imgs.push({ url: a, kind: 'bg', sel: sel(e), w: r.width, h: r.height, nw: n[0], nh: n[1], size: cs.backgroundSize, repeat: cs.backgroundRepeat }); }
      for (const u of urlOf(cs.maskImage || '')) { const a = new URL(u, location.href).href, n = nat(a); out.imgs.push({ url: a, kind: 'mask', sel: sel(e), w: r.width, h: r.height, nw: n[0], nh: n[1] }); }
    }
    for (const a of document.getAnimations()) { try { const ef = a.effect, t = ef && ef.target, kf = ef && ef.getKeyframes ? ef.getKeyframes() : [], props = new Set(); kf.forEach((k) => Object.keys(k).forEach((p) => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); }));
      const r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : { width: 0, height: 0 }; const tm = ef ? ef.getTiming() : {};
      out.anims.push({ target: t ? sel(t) : '?', name: a.animationName || a.transitionProperty || 'waapi', kind: a.constructor.name, props: [...props], nonCompositor: [...props].filter((p) => !COMPOSITOR_OK.has(p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))), dur: tm.duration, iter: tm.iterations === Infinity ? 'inf' : tm.iterations, state: a.playState, area: Math.round(r.width * r.height) }); } catch (e) { /* skip */ } }
    return out;
  }
  window.__fb5scenes = { S, survey, now };
})();
