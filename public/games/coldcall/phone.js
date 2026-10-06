/* COLD CALL phone feature. Replays spin.phone from the script: the call connects, every hot lead flips (quote bubble / UPSELL / THE CLOSE),
   upsells push their neighbours, closes collect, and phone.pay counts into the running total. Nothing here chooses a value: bubbles show
   reveal.v, upsells show hits[].before -> after, closes show collects[].value. `S` only remembers what the screen currently shows so the
   self-check can compare it with the script's own totals (took, run, pay). */
(() => {
  const CC = (window.CC = window.CC || {});
  const K = () => CC.core, B = () => CC.board, SFX = () => K().SFX;
  const TN = ['quote_bronze', 'quote_silver', 'quote_gold'];
  const amt = (c) => (c < 100 ? c + 'c' : c < 1000000 ? '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)) : '$' + String(+(c / 100000).toFixed(1)) + 'k');
  const S = new Map();                                        // p -> { k, v, el, collected }
  const A = (el, kf, o) => B().A(el, kf, o);
  const mkEl = (cls, p) => { const el = document.createElement('div'); el.className = cls; const [x, y] = B().xy(p); el.style.left = x + 'px'; el.style.top = y + 'px'; return el; };
  const ctr = (p) => { const [x, y] = B().xy(p); return [x + B().CELL / 2, y + B().CELL / 2]; };
  const setTxt = (el, c) => { const s = amt(c), n = el.querySelector('.amt, .cv'); n.textContent = s; n.dataset.l = s.length > 5 ? 6 : s.length; };

  function node(r, ctx) {
    if (r.k === 'b') { const el = mkEl('rv b t' + r.t, r.p); el.append(CC.assets.img(TN[r.t], 'bub')); const s = document.createElement('span'); s.className = 'amt'; el.append(s); setTxt(el, ctx.cents(r.v)); return el; }
    if (r.k === 'u') { const el = mkEl('rv u', r.p); el.innerHTML = '<b>x' + r.v + '</b><i>UPSELL</i>'; return el; }
    const el = mkEl('rv c', r.p); el.innerHTML = '<span class="cm"></span><span class="cv" data-l="5">CLOSE</span><em class="mx"></em>'; return el;
  }
  const flipIn = (el, delay) => A(el, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1.14)', offset: 0.65 }, { transform: 'scaleX(1)' }], { duration: 230, delay, fill: 'backwards', easing: 'ease-out' });
  const flipOut = (el, delay) => A(el, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 110, delay, fill: 'forwards' }).then(() => el.remove());
  const bump = (el, s = 1.22) => A(el, [{ transform: 'scale(1)' }, { transform: `scale(${s})`, offset: 0.4 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  const sum = () => { let t = 0; S.forEach((s) => { if (s.k === 'b' || (s.k === 'c' && s.collected)) t += s.v; }); return t; };
  const bad = (o) => CC.dbg.mismatch.push(o);
  let paid = 0;                                               // tenths of phone money already in the WIN meter

  async function reveal(round, ri, ctx) {
    const rs = round.reveals, stag = Math.min(70, 650 / Math.max(1, rs.length));
    rs.forEach((r, i) => {
      const old = S.get(r.p), el = node(r, ctx), d = i * stag + (old ? 120 : 0);
      if (old) flipOut(old.el, i * stag);
      B().ovl().appendChild(el); S.set(r.p, { k: r.k, v: r.v, t: r.t, el, collected: false });
      flipIn(el, d); setTimeout(() => { const c = B().el(r.p); if (c) c.classList.add('under'); }, (d + 70) * K().speed());   // the symbol goes when the flip is under way
      if (i < 9 || i % 3 === 0) setTimeout(() => (r.k === 'b' ? SFX().reveal(r.t) : r.k === 'u' ? SFX().upsellReveal() : SFX().closeReveal()), d * K().speed());
    });
    await K().wait(rs.length * stag + (ri ? 260 : 380));
  }

  async function upsell(u, ctx) {
    const me = S.get(u.p); SFX().upsell(u.m); bump(me.el, 1.3); const [ux, uy] = ctr(u.p), ps = [];
    u.hits.forEach((h, i) => {
      const t = S.get(h.p), [hx, hy] = ctr(h.p), z = document.createElement('i'); z.className = 'zap'; z.style.left = ux - 9 + 'px'; z.style.top = uy - 9 + 'px'; B().ovl().appendChild(z);
      if (!(h.k === 'c' && h.pend)) t.v = h.after;                  // what the screen holds changes now; only the picture below waits for its animation
      ps.push(A(z, [{ transform: 'translate(0,0) scale(.6)', opacity: 1 }, { transform: `translate(${hx - ux}px,${hy - uy}px) scale(1.3)`, opacity: 1 }], { duration: 240, delay: i * 90, easing: 'ease-in' }).then(() => {
        z.remove(); bump(t.el, 1.25); SFX().upsellHit();
        const tag = document.createElement('b'); tag.className = 'tag'; tag.textContent = 'x' + u.m; tag.style.left = hx + 'px'; tag.style.top = hy - 18 + 'px'; B().ovl().appendChild(tag);
        A(tag, [{ transform: 'translate(-50%,0) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-6px) scale(1.15)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-26px) scale(1)', opacity: 0 }], { duration: 700, easing: 'ease-out' }).then(() => tag.remove());
        if (h.k === 'b' || !h.pend) return K().tween(h.before, h.after, 380, (x) => setTxt(t.el, ctx.cents(Math.round(x)))).then(() => setTxt(t.el, ctx.cents(h.after)));
        t.el.querySelector('.mx').textContent = 'x' + h.after;       // a close that has not collected yet stores the multiplier
      }));
    });
    await Promise.all(ps); await K().wait(260);
  }

  async function collect(c, ctx, first) {
    const me = S.get(c.p), srcs = [...S.entries()].filter(([p, s]) => p !== c.p && (s.k === 'b' || (s.k === 'c' && s.collected)));
    me.el.classList.add('live'); SFX().closeStart(); bump(me.el, 1.3); await K().wait(first ? 260 : 140);
    const [tx, ty] = ctr(c.p), n = srcs.length, gap = Math.min(55, 520 / Math.max(1, n)); let shown = 0; const ps = [];
    srcs.forEach(([p, s], i) => {
      shown += s.v; const [sx, sy] = ctr(p), ch = document.createElement('b'); ch.className = 'fchip'; ch.textContent = amt(ctx.cents(s.v)); ch.style.left = sx + 'px'; ch.style.top = sy - 27 + 'px'; B().ovl().appendChild(ch);
      ps.push(A(ch, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${tx - sx}px),calc(-50% + ${ty - sy + 27}px)) scale(.6)`, opacity: 0.9 }], { duration: 300, delay: i * gap, easing: 'ease-in' }).then(() => { ch.remove(); bump(me.el, 1.12); if (i < 10 || i % 3 === 0) SFX().collect(i); }));
    });
    await Promise.all(ps);
    if (shown !== c.took) bad({ what: 'close took', p: c.p, shown, script: c.took });
    me.collected = true; me.v = c.value;                            // state first, then the picture
    const lcd = K().tween(0, c.value, first ? 520 : 360, (x) => setTxt(me.el, ctx.cents(Math.round(x)))).then(() => setTxt(me.el, ctx.cents(c.value)));
    if (c.m > 1) me.el.querySelector('.mx').textContent = 'x' + c.m;
    me.el.classList.remove('live'); me.el.classList.add('done');
    SFX().stamp(); if (c.value >= 250) { CC.hero.mood('win', 2600); K().FX.coins(14); K().FX.ring(...K().stagePt(me.el), { n: 2, r1: 120 }); }
    await Promise.all([accept(first, ctx, c.p), lcd]);
    if (sum() !== c.run) bad({ what: 'close run', p: c.p, shown: sum(), script: c.run });
    ctx.rib('THE CLOSE', ''); const d = Math.min(c.run, ctx.phonePay) - paid; if (d > 0) { paid += d; await ctx.addWin(d, 520); }   // WIN counts every close as it lands
  }

  // PAYMENT ACCEPTED: the seal piece is stamped on the corner of the card machine, the slip (CSS text) sits under the hero's chin so the board stays readable
  async function accept(first, ctx, p) {
    const d = mkEl('accept' + (first ? '' : ' sm'), p); d.innerHTML = '<i></i>'; B().ovl().appendChild(d);
    if (first) K().stamp('PAYMENT ACCEPTED', '', 900, document.getElementById('head'));
    await Promise.all([A(d, [{ transform: 'scale(2.4) rotate(-14deg)', opacity: 0 }, { transform: 'scale(.92) rotate(-6deg)', opacity: 1, offset: 0.25 }, { transform: 'scale(1) rotate(-6deg)', opacity: 1, offset: 0.75 }, { transform: 'scale(1) rotate(-6deg)', opacity: 0 }], { duration: first ? 900 : 560, easing: 'ease-out' }), K().wait(first ? 620 : 380)]);
    d.remove();
  }

  async function run(spin, ctx) {
    const ph = spin.phone, B_ = B(); S.clear(); paid = 0; ctx.phonePay = ph.pay;   // a close's running total can exceed what finally pays (later reveals re-flip leads): the meter never goes past phone.pay
    // 1. the call connects
    B_.cellsOf('phone').forEach((p) => B_.el(p).classList.add('pulse', 'ring')); SFX().phoneRing(); K().say('phone'); CC.hero.mood('hype', 1800);
    ctx.rib('CONNECTED', ph.leads.length + (ph.leads.length === 1 ? ' LEAD' : ' LEADS')); K().stamp('CALL CONNECTED', ph.leads.length + (ph.leads.length === 1 ? ' HOT LEAD' : ' HOT LEADS'), 1000, document.getElementById('head'));   // under the hero's chin: the lit squares stay in view
    await K().wait(1000); B_.cellsOf('phone').forEach((p) => B_.el(p).classList.remove('pulse', 'ring'));
    // 2. the rounds
    for (let ri = 0; ri < ph.rounds.length; ri++) {
      const rd = ph.rounds[ri];
      await reveal(rd, ri, ctx);
      for (const u of rd.upsells) await upsell(u, ctx);
      let first = true; for (const c of rd.collects) { await collect(c, ctx, first); first = false; }
      if (rd.collects.length && ri < ph.rounds.length - 1) { K().say('close'); await K().wait(300); }
    }
    // 3. what is on the board pays
    if (!ph.capped && sum() !== ph.pay) bad({ what: 'phone pay', shown: sum(), script: ph.pay });
    ctx.rib('PAYING OUT', ''); SFX().coin();
    if (ph.pay !== paid) await ctx.addWin(ph.pay - paid, 650); await K().wait(450);
    // 4. clean up: every reveal leaves, the symbols come back
    const kids = [...B_.ovl().children]; kids.forEach((n, i) => { if (n.classList.contains('rv')) flipOut(n, Math.min(i * 12, 160)); });
    await K().wait(300); B_.ovl().replaceChildren(); S.forEach((_, p) => B_.el(p).classList.remove('under')); S.clear();
  }

  CC.phone = { run, amt };
})();
