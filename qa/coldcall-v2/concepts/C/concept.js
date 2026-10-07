MOCK.start((M) => {
  const { $, el, num, state } = M, board = $('board'), ovl = $('ovl'), scene = $('scene'), head = $('head'), full = state === 'callback';
  const bar = $('modebar');

  // top bar becomes the ticker tape: friends feed + office pot
  $('modenote').outerHTML = `<span class="tape"><span class="feed"><b>MATT</b> closed <em>2,400x</em></span><span class="pot"><small>OFFICE POT</small>${state === 'pot' ? '$50.00' : num.pot}</span></span>`;
  if (state === 'pot') bar.classList.add('gold');

  // leads: a note stuck over the painted top-left sticky
  const stack = el('div', 'note' + (full ? ' full' : ''), full ? `<img src="${M.sym('note')}" alt=""><div class="fl">FULL 400</div>` : `<small>LEADS</small><b>${num.leads}</b><em>of ${num.max}</em><div class="bar"><i style="--w:${(num.leads / num.max * 100).toFixed(1)}%"></i></div>`); stack.id = 'stack'; board.appendChild(stack);
  // appointment: a note over the painted bottom-right sticky
  board.appendChild(el('div', 'note', `<small>APPT</small><b>DAY ${num.day}</b><em>+${num.dailyLeads} leads</em>`)).id = 'apptn';

  // cold line: head-band note (in bonus the bonus chips take the corner)
  if (state !== 'pot' && state !== 'ghost') head.appendChild(el('div', 'note', `<u>${num.coldN} leads</u> go cold in ${num.coldT}`)).id = 'cold';
  if (state === 'ghost') head.appendChild(el('div', 'note', `<u>${num.coldN} leads</u> go cold in ${num.coldT}`)).id = 'cold';

  if (M.hasWarm) M.warm.forEach((p) => { $('slots').children[p].classList.add('warm'); const t = M.cellEl('wfl', p); t.innerHTML = `<i>${num.bet}</i>`; ovl.appendChild(t); });

  if (full) { $('ribbon').classList.add('gold'); $('ribL').textContent = 'FREE BONUS AT ' + num.cbBet; $('spin').classList.add('cb'); $('spin').firstChild.textContent = 'CALLBACK'; $('betM').classList.add('cb'); $('betM').firstElementChild.textContent = 'FREE BONUS AT'; $('bet').textContent = num.cbBet; M.say('They called back.<br>Spin.'); }
  if (state === 'idle') M.say('Fresh leads. Slightly used.');
  if (state === 'pick') {
    M.say('Tap a lit lead.<br>It pays more.'); M.hot.pick.forEach((p) => $('slots').children[p].classList.add('pk'));
    head.appendChild(el('div', 'note', `<b>PICK YOUR LEAD</b><small>tap a lit square</small><div class="tm"><i style="--w:68%"></i><span>14</span></div>`)).id = 'pickn';
    $('cap').style.display = 'none';       // the note is the prompt; the bubble steps aside
  }
  if (state === 'more') {
    M.mood('hype'); M.say('One more call?');
    scene.appendChild(el('div', '', `<div class="tape2"><b>0:11 TO DECIDE</b><div class="tm"><i style="--w:55%"></i></div></div>
      <div class="note l"><b>HANG UP</b><small>and bank</small><em>${num.bank}</em></div>
      <div class="note r red"><b>ONE MORE CALL</b><em>x2 OR NOTHING</em><small>wins ${num.pWin}  |  pays ${num.gamble}</small></div>`)).id = 'two';
  }
  if (state === 'ghost') {
    M.mood('shock'); $('cap').style.display = 'none';
    head.appendChild(el('div', 'gstamp', `WOULD HAVE CLOSED<strong>${num.ghost}</strong>`));
    M.hot.ghost.forEach((p, i) => { const s = $('slots').children[p]; const r = M.cellEl('rv b ghostrv t' + i, p); r.innerHTML = `<img class="bub" src="${M.sym(['quote_bronze', 'quote_silver', 'quote_gold'][i])}"><span class="amt" data-l="5">${M.ghostAmt[p]}</span>`; if (i === 2) { r.style.transform = 'scaleX(.38)'; r.style.opacity = .8; } ovl.appendChild(r); s.classList.add('pk'); });
  }
  if (state === 'pot') {
    M.mood('win'); M.say('The pot. Yours.'); $('win').textContent = '$37.00';
    scene.appendChild(el('div', '', `<i class="cw l"></i><small>THE OFFICE POT</small><b>YOU TOOK IT</b><em>${num.potWin}</em><span>on top of your win. Outside the cap.</span><i class="cw r"></i>`)).id = 'potn';
  }
  M.tail();
});
