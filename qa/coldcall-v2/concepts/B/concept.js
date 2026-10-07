MOCK.start((M) => {
  const { $, el, num, state } = M, board = $('board'), ovl = $('ovl'), scene = $('scene'), hud = $('hud');
  const full = state === 'callback', n = full ? 400 : num.leads, ribbon = $('ribbon');

  // rolodex strip in the bezel top
  let cards = ''; const N = 20, filled = Math.floor(n / 20);
  for (let i = 0; i < N; i++) { const r = ((i - 9.5) * 1.5).toFixed(1); const cls = i === N - 1 ? 'cb' + (full ? ' up' : '') : i < filled ? 'on' : i === filled && !full ? 'cur' : ''; cards += `<u class="${cls}" style="left:${i * 10.4}px;--r:${r}deg;--tab:${['#e9b23a', '#5cc7dc', '#d8402e', '#3b8a4a'][i % 4]}"></u>`; }
  const rolo = el('div', full ? 'full' : '', `<div class="t"><small>${full ? 'FILE FULL' : 'LEADS'}</small><b>${n} <i>/ ${num.max}</i></b></div><div class="cards">${cards}</div>`); rolo.id = 'rolo'; board.appendChild(rolo);

  // ribbon: feed at the right end
  const rr = $('ribR'); rr.className = 'r feed'; rr.innerHTML = '<s>MATT</s>closed 2,400x';
  if (full) { ribbon.classList.add('gold'); $('ribL').textContent = 'FREE BONUS AT ' + num.cbBet; }
  if (state === 'pot') { ribbon.classList.add('gold'); $('ribL').textContent = 'THE POT IS YOURS'; rr.innerHTML = '<s>POT RESETS TO</s>$50.00'; }
  if (state === 'pick') { ribbon.classList.add('ask'); ribbon.style.setProperty('--left', '68%'); $('ribL').textContent = 'PICK YOUR LEAD'; rr.innerHTML = '0:14'; }
  if (state === 'more') { $('ribL').textContent = 'ONE MORE CALL?'; rr.innerHTML = `${num.pWin} x2 = ${num.gamble}`; }

  // lips: calendar leaf + mug pot
  board.appendChild(el('div', 'lipb', `<small>APPT</small><b>DAY ${num.day}<i>+${num.dailyLeads}</i></b>`)).id = 'leaf';
  board.appendChild(el('div', 'lipb', `<div class="m"><i></i>POT</div><b>${state === 'pot' ? '$50.00' : num.pot}</b>`)).id = 'potb';

  // warm squares + stamps
  if (M.hasWarm) M.warm.forEach((p) => { $('slots').children[p].classList.add('warm'); const t = M.cellEl('wst', p); t.innerHTML = `<i>${num.bet}</i>`; ovl.appendChild(t); });

  // cold line: tape in the fine row
  const fine = $('fine'); fine.classList.add('tape'); fine.innerHTML = `<b>${num.coldN} leads</b> go cold in ${num.coldT}`;
  if (state === 'more' || state === 'pot') { /* cold line stays: it is always shown when non-null */ }

  if (full) { $('spin').classList.add('cb'); $('spin').firstChild.textContent = 'CALLBACK'; $('betM').classList.add('cb'); $('betM').firstElementChild.textContent = 'FREE BONUS AT'; $('bet').textContent = num.cbBet; M.say('They called back.<br>Spin.'); }
  if (state === 'idle') M.say('Fresh leads. Slightly used.');
  if (state === 'pick') { M.say('Tap a lit lead.<br>It pays more.'); M.hot.pick.forEach((p) => $('slots').children[p].classList.add('pk')); }
  if (state === 'more') {
    M.mood('hype'); M.say('One more call?'); hud.classList.add('dec');
    hud.insertBefore(el('div', 'dec2', `<button class="k hang"><b>HANG UP</b><em>BANK ${num.bank}</em></button><div class="dl" style="--deg:${360 * 0.55}deg"><span>11</span></div><button class="k more"><b>ONE MORE CALL</b><em>x2 OR NOTHING</em><small>wins ${num.pWin}</small></button>`), hud.firstChild);
  }
  if (state === 'ghost') {
    M.mood('shock'); M.say('So close.'); const wb = $('winbox'); wb.classList.add('ghost'); wb.querySelector('.lbl').innerHTML = 'WOULD HAVE<br>CLOSED'; $('win').textContent = num.ghost;
    M.hot.ghost.forEach((p, i) => { const s = $('slots').children[p]; const r = M.cellEl('rv b ghostrv t' + i, p); r.innerHTML = `<img class="bub" src="${M.sym(['quote_bronze', 'quote_silver', 'quote_gold'][i])}"><span class="amt" data-l="5">${M.ghostAmt[p]}</span>`; if (i === 2) { r.style.transform = 'scaleX(.38)'; r.style.opacity = .8; } ovl.appendChild(r); s.classList.add('pk'); });
  }
  if (state === 'pot') {
    M.mood('win'); M.say('The pot. Yours.'); $('win').textContent = '$37.00';
    scene.appendChild(el('div', '', `<i class="cw l"></i><i class="mug"></i><small>THE OFFICE POT</small><b>YOU TOOK IT</b><em>${num.potWin}</em><span>on top of your win. Outside the 10,000x cap.</span><i class="cw r"></i>`)).id = 'potw';
  }
  M.tail();
});
