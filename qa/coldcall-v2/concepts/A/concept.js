MOCK.start((M) => {
  const { $, el, num, state } = M, head = $('head'), board = $('board'), ovl = $('ovl'), scene = $('scene');
  const boxes = (n) => { let h = ''; for (let i = 0; i < 40; i++) { const f = n / 10; h += `<u class="${i < Math.floor(f) ? 'on' : i === Math.floor(f) && f % 1 ? 'part' : ''}${i === 39 ? ' last' : ''}"></u>`; } return h; };
  const full = state === 'callback';
  if (state === 'pot') M.noSheet = true;

  // lead sheet (head band); gone during a bonus (the bonus chips take that corner)
  if (!M.noSheet) head.appendChild(el('div', '', `<div class="h"><b>LEAD SHEET</b><span>${full ? 400 : num.leads} <i>/ ${num.max}</i></span></div><div class="g">${boxes(full ? 400 : num.leads)}</div><div class="f">${full ? '<b>FULL.</b> Free bonus next spin' : `<b>${num.coldN} leads</b> go cold in ${num.coldT}`}</div>${full ? '<div class="cb">CALLBACK</div>' : ''}`)).id = 'sheet';
  if (full) $('sheet').classList.add('full');

  // pot in the ribbon, always
  const rr = $('ribR'); rr.className = 'r pot'; rr.innerHTML = `<small>OFFICE POT</small>${state === 'pot' ? '$50.00' : num.pot}`;
  if (full) { $('ribbon').classList.add('gold'); $('ribL').textContent = 'FREE BONUS AT ' + num.cbBet; }
  if (state === 'pot') { $('ribbon').classList.add('gold'); $('ribL').textContent = 'THE POT RESETS'; }

  // feed strip in the bezel top (prompt in its place during a pick)
  const strip = el('div', '', ''); strip.id = 'strip';
  if (state === 'pick') { strip.className = 'ask'; strip.style.setProperty('--left', '68%'); strip.innerHTML = '<b>PICK YOUR LEAD</b><span>0:14</span>'; }
    else strip.innerHTML = `<i class="dot"></i><span><b>MATT</b> just closed <em>2,400x</em></span>`;
  board.appendChild(strip);

  // lip chips: appointment (left), warm leads (right)
  const ap = el('div', 'lipc', `<small>APPT DAY ${num.day}</small><b>+${num.dailyLeads} LEADS</b>`); ap.id = 'appt'; board.appendChild(ap);
  const wc = el('div', 'lipc', M.hasWarm ? `<small>4 WARM</small><b>at ${num.bet}</b>` : `<small>0 WARM</small><b>none yet</b>`); wc.id = 'warmc'; board.appendChild(wc);

  // warm squares + their bet tags
  if (M.hasWarm) M.warm.forEach((p) => { $('slots').children[p].classList.add('warm'); const t = M.cellEl('wtag', p); t.innerHTML = `<i>${num.bet}</i>`; ovl.appendChild(t); });

  // spin / bet: CALLBACK
  if (full) { $('spin').classList.add('cb'); $('spin').firstChild.textContent = 'CALLBACK'; $('betM').classList.add('cb'); $('betM').firstElementChild.textContent = 'FREE BONUS AT'; $('bet').textContent = num.cbBet; M.say('They called back.<br>Spin.'); }

  if (state === 'idle') M.say('Fresh leads. Slightly used.');
  if (state === 'pick') {
    M.say('Tap a lit lead.<br>It pays more.'); M.hot.pick.forEach((p) => $('slots').children[p].classList.add('pk'));
  }
  if (state === 'more') {
    M.mood('hype'); M.say('One more call?');
    scene.appendChild(el('div', 'slip', `<div class="top"><span>WHILE YOU WERE OUT</span><span>BONUS OVER</span></div><h2>ONE MORE CALL?</h2><div class="tm" style="--left:55%"><span>0:11</span></div>
      <div class="two"><button class="k hang"><b>HANG UP</b><em>BANK ${num.bank}</em></button><button class="k more"><b>ONE MORE CALL</b><em>x2 OR NOTHING</em><small>wins ${num.pWin}  |  pays ${num.gamble}</small></button></div>
      <div class="odds">${num.pWin} you double. ${100 - parseInt(num.pWin)}% you leave with <b>$0.00</b>.</div>`));
  }
  if (state === 'ghost') {
    M.mood('shock'); $('cap').classList.add('ghost'); $('capT').innerHTML = `<small>WOULD HAVE CLOSED</small><strong>${num.ghost}</strong>`;
    M.hot.ghost.forEach((p, i) => { const s = $('slots').children[p]; const a = M.ghostAmt[p], tier = ['quote_bronze', 'quote_silver', 'quote_gold'][i]; const r = M.cellEl('rv b ghostrv t' + i, p); r.innerHTML = `<img class="bub" src="${M.sym(tier)}"><span class="amt" data-l="5">${a}</span>`; if (i === 2) { r.style.transform = 'scaleX(.38)'; r.style.opacity = .8; } ovl.appendChild(r); s.classList.add('pk'); });
  }
  if (state === 'pot') {
    M.mood('win'); $('cap').style.display = 'none'; M.mood('win');
    head.appendChild(el('div', '', `<div class="st"><i class="cw l"></i><small>YOU TOOK</small><b>THE OFFICE POT</b><em>${num.potWin}</em><span>on top of your win. Outside the 10,000x cap.</span><i class="cw r"></i></div>`)).id = 'potwin';
    $('win').textContent = '$37.00';
  }
  M.tail();
});
