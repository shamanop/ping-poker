/* QUOTE ACCEPTED bonus (hold and respin). Everything shown comes from the script: which boxes the bubbles land in, the amounts, the
   upsells, which fields finish. Bubbles fly off the reels into a checkout form (CVV 3, EXPIRY 4, NAME 5, CARD 6). */
(() => {
  const CC = (window.CC = window.CC || {});
  const TIER_LABEL = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', mega: 'MEGA' };

  function buildForm(ctx, f) {
    const E = ctx.E, scn = document.createElement('div'); scn.className = 'scn quote'; scn.style.opacity = 0;
    scn.innerHTML = '<h2 style="font-size:34px">QUOTE ACCEPTED</h2><div class="rsp"><span>RESPINS</span><i class="d"></i><i class="d"></i><i class="d"></i></div><div class="form"></div>';
    const form = scn.querySelector('.form'), boxes = [], rows = [];
    E.FIELDS.forEach((F, i) => {
      const row = document.createElement('div'); row.className = 'frow'; row.style.setProperty('--c', `var(--tier-${F.tier})`);
      const prize = E.CFG.fieldPrize[F.id];
      row.innerHTML = `<div class="fl">${F.name}<em>${TIER_LABEL[F.tier]}</em></div><div class="fb"></div><div class="fp"><b>${ctx.boxFmt(ctx.cents(prize))}</b><small>${F.size} BOXES</small></div><span class="mult"></span>`;
      const fb = row.querySelector('.fb');
      for (let k = 0; k < F.size; k++) { const b = document.createElement('div'); b.className = 'fbox'; b.innerHTML = '<span class="v"></span>'; fb.appendChild(b); boxes[F.from + k] = b; }
      form.appendChild(row); rows.push(row);
    });
    return { scn, boxes, rows, dots: [...scn.querySelectorAll('.rsp .d')] };
  }
  function fill(ctx, form, box, item, state) {
    const b = form.boxes[box], fieldI = ctx.E.FIELD_OF[box]; b.classList.add('full'); b.classList.remove('spinning');
    if (item.upsell) {
      b.classList.add('up'); b.innerHTML = ''; b.appendChild(CC.assets.img('upsell')); state.up[fieldI] = Math.min(3, (state.up[fieldI] || 0) + 1);
      form.rows[fieldI].querySelector('.mult').textContent = 'UPSELL x' + (1 << state.up[fieldI]); ctx.SFX.chime(5); ctx.stamp('UPSELL!', ctx.E.FIELDS[fieldI].name + ' x' + (1 << state.up[fieldI]), 1000, ctx.sceneEl);
    } else { b.querySelector('.v').textContent = ctx.boxFmt(ctx.cents(item.amt)); ctx.SFX.pop(); }
    ctx.anim(b, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }
  const setDots = (form, n) => form.dots.forEach((d, i) => d.classList.toggle('on', i < n));

  async function run(f, base, ctx) {
    const E = ctx.E;
    // 1. trigger: amounts pop onto the bubbles that landed on the reels
    ctx.say('quote'); ctx.SFX.sting();
    const cells = base ? base.quotes : [], srcEls = [];
    f.start.forEach((s, k) => {
      const q = cells[k]; if (!q) return; const el = ctx.cellEl(q.c, q.r); if (!el) return; srcEls[k] = el;
      const a = document.createElement('span'); a.className = 'amt'; a.textContent = ctx.boxFmt(ctx.cents(s.amt)); el.appendChild(a); el.classList.add('pulse');
      setTimeout(() => ctx.SFX.pop(), k * 90 * (ctx.st.skip ? 0.3 : 1)); ctx.anim(a, [{ transform: 'translate(-50%,-50%) scale(0)' }, { transform: 'translate(-50%,-50%) scale(1.3)', offset: 0.6 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 300, delay: k * 90 });
    });
    ctx.stamp('QUOTE ACCEPTED!', f.startCount + ' quotes', 1500, document.getElementById('head')); ctx.FX.shake(6, 350); await ctx.wait(1400 + f.start.length * 40);
    // 2. the form (invisible until the bubbles lift off), then the flight
    const form = buildForm(ctx, f); ctx.sceneEl.replaceChildren(form.scn); setDots(form, E.CFG.respins);
    const state = { up: [] }, [bx, by] = ctx.stagePt(ctx.board);
    const flights = f.start.map((s, k) => new Promise((res) => {
      const dst = form.boxes[s.box], [dx, dy] = ctx.stagePt(dst);
      const src = srcEls[k] ? ctx.stagePt(srcEls[k]) : [bx + (Math.random() - 0.5) * 300, by + (Math.random() - 0.5) * 200];
      const fl = document.createElement('div'); fl.className = 'fly'; fl.style.left = (dx - 22) + 'px'; fl.style.top = (dy - 22) + 'px'; fl.appendChild(CC.assets.img('quote'));
      const lab = document.createElement('span'); lab.textContent = ctx.boxFmt(ctx.cents(s.amt)); fl.appendChild(lab); ctx.ov.appendChild(fl);
      setTimeout(() => { ctx.SFX.whoosh(); }, k * 80 * (ctx.st.skip ? 0.3 : 1));
      ctx.anim(fl, [{ transform: `translate(${src[0] - dx}px,${src[1] - dy}px) scale(1.5)`, opacity: 1 }, { transform: 'translate(0,0) scale(.9)', opacity: 1, offset: 0.92 }, { transform: 'translate(0,0) scale(.9)', opacity: 0 }], { duration: 650, delay: 120 + k * 80, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' })
        .then(() => { fl.remove(); fill(ctx, form, s.box, s, state); ctx.addWin(s.amt, 250); res(); });
    }));
    ctx.anim(form.scn, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }).then(() => { form.scn.style.opacity = 1; });
    await Promise.all(flights); await ctx.wait(500);
    // 3. respins
    ctx.rib('QUOTE ACCEPTED', 'RESPINS ' + E.CFG.respins);
    for (const rs of f.respins) {
      const empties = form.boxes.filter((b) => !b.classList.contains('full')); empties.forEach((b) => b.classList.add('spinning')); ctx.SFX.dialWhirr(450);
      await ctx.wait(520);
      empties.forEach((b) => b.classList.remove('spinning'));
      for (const l of rs.landed) { fill(ctx, form, l.box, l, state); if (l.amt) ctx.addWin(l.amt, 250); await ctx.wait(260); }
      if (rs.reset && rs.landed.length) { setDots(form, rs.left); ctx.stamp('RESET', rs.left + ' RESPINS', 800, ctx.sceneEl); } else setDots(form, rs.left);
      ctx.rib('QUOTE ACCEPTED', 'RESPINS ' + rs.left); await ctx.wait(rs.landed.length ? 450 : 260);
    }
    // 4. pay the fields: upsell bonus first, then the field prize
    await ctx.wait(400);
    for (let i = 0; i < f.fields.length; i++) {
      const F = f.fields[i], row = form.rows[i], [rx, ry] = ctx.localPt(row, ctx.sceneEl);
      if (!F.done && !(F.upsells > 0 && F.filled > 0)) { row.classList.add('dim'); continue; }
      if (F.upsells > 0 && F.sum > 0) {
        const extra = F.sum * (F.mult - 1); ctx.SFX.chime(3); ctx.floatAt(rx, ry, `<span>UPSELL x${F.mult} +${ctx.dollars(ctx.cents(extra))}</span>`); await ctx.addWin(extra, 450); await ctx.wait(500);
      }
      if (F.done) {
        row.classList.add('done'); ctx.SFX.field(i); ctx.FX.burst(...ctx.stagePt(row), { n: 18, speed: 300, size: 8 });
        ctx.floatAt(rx, ry, `<span>${TIER_LABEL[F.tier]}</span><b>+${ctx.dollars(ctx.cents(F.prize))}</b>`); await ctx.addWin(F.prize, 500); await ctx.wait(650);
      } else row.classList.add('dim');
    }
    if (f.grand) {
      const bn = document.createElement('div'); bn.className = 'banner'; bn.innerHTML = '<b></b><i></i>'; bn.firstChild.textContent = 'PAYMENT ACCEPTED'; bn.lastChild.textContent = '+' + ctx.dollars(ctx.cents(f.grandPrize));
      ctx.ov.appendChild(bn); ctx.SFX.accepted(); ctx.FX.coins(60); ctx.FX.confetti(40); ctx.FX.ring(270, 420, { n: 3, r1: 200 }); ctx.FX.shake(10, 600);
      ctx.anim(bn, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.5 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 500, fill: 'forwards' });
      await ctx.addWin(f.grandPrize, 900); await ctx.wait(2200); bn.remove();
    }
    // 5. finale
    if (!(ctx.willBig && ctx.isLast)) {
      if (!f.grand) ctx.SFX.register();
      const end = document.createElement('div'); end.className = 'scn';
      end.innerHTML = '<h2>QUOTE<br>ACCEPTED</h2><div class="chip set" style="width:100%"><small>BONUS WIN</small><b></b></div><p class="sub"></p><div class="tap">TAP TO CONTINUE</div>';
      end.querySelector('b').textContent = ctx.dollars(ctx.cents(f.totalTenths));
      end.querySelector('.sub').textContent = f.fields.filter((x) => x.done).map((x) => x.name).join(' + ') || 'No field completed';
      ctx.sceneEl.replaceChildren(end); await ctx.waitTap(7000);
    } else await ctx.wait(500);
    ctx.sceneEl.replaceChildren(); ctx.ov.querySelectorAll('.fly,.banner').forEach((n) => n.remove());
    for (const a of document.querySelectorAll('.cell .amt')) a.remove(); ctx.clearHits(); ctx.rib('3+ in a row, left to right', 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x');
  }
  CC.quote = { run };
})();
