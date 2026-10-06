/* Speech bubble for the hero. Sized to its text (CSS width:max-content), tail aimed at the hero's mouth (a fraction pair from the art
   manifest, so new art brings its own mouth point). Fitted ONCE per line (and once per layout change); never per frame. */
(() => {
  const CC = (window.CC = window.CC || {});
  const LINES = {
    idle: ['Thanks for holding. Your call is important to me.', 'This call may be recorded for quality and sadness.', 'I have a quote with your name on it.', 'Let me transfer you to... me.', 'Press 1 to spin. Press 1 to spin.', 'Hello? Hello? Oh, it is you!', 'Fresh leads. Slightly used.', 'Is this a good time? It is always a good time.'],
    spin: ['Dialing...', 'Ringing, ringing...', 'Please hold, closing in progress.', 'Let me pull up your file.', 'Cold call, warm hands.', 'Smile. They can hear it.'],
    tease: ['Two bells... one more!', 'Ding ding... where is the third?', 'So close to the bell!', 'One more bell, come on...'],
    lose: ['Voicemail again.', 'They hung up. Rude.', 'Not interested. Lovely tone, though.', 'I will circle back. Never.', 'That one was a warm-up call.', 'Gatekeeper got me.'],
    smallWin: ['A little commission!', 'Quota getting closer.', 'Ka-ching, quietly.', 'Put it on the board.'],
    nice: ['Nice close!', 'Now we are selling!', 'Send the invoice!'],
    bigWin: ['Top of the leaderboard!', 'Frame that check!', 'Who is closing? I am closing!'],
    phone: ['The call connects!', 'Somebody picked up!', 'Dialing every hot lead...', 'Hello? Hello! It is a live one!'],
    close: ['Closing the deal!', 'Sign here, and here, and here.', 'Everything on the board is mine.', 'Payment accepted!'],
    bonus1: ['Dialing for dollars!', 'Hot leads stay hot!', 'Every ring counts!'],
    bonus2: ['Always. Be. Closing.', 'Leads never go cold now.', 'Coffee is for closers.'],
    bonus3: ['Quote accepted! Quote accepted!', 'A phone on every call!', 'Sign the whole board!'],
    added: ['More calls to make!', 'Extra spins, extra commission!', 'The bells keep ringing!'],
    freeSpin: ['Every ring counts!', 'Free calls, full commission!', 'Keep dialing!', 'Callbacks pay double. Not really, but still.'],
    rage: ['FOUR voicemails in a row?!', 'I will eat this phone!', 'Who keeps hanging up on me?!', 'That is it. I am calling my manager.'],
    buy: ['Skipping the small talk.', 'Straight to the close.']
  };
  const pickFrom = (g, last) => { const p = LINES[g] || LINES.idle; let t = p[0]; for (let i = 0; i < 6; i++) { t = p[(Math.random() * p.length) | 0]; if (t !== last) break; } return t; };
  let last = '', curText = '';
  function fit() {
    const bub = document.getElementById('cap'), head = document.getElementById('head'), hero = document.getElementById('hero'), tail = document.getElementById('capTail');
    if (!bub || !head || !hero.naturalWidth) return;
    // hero image box inside the head (object-fit: contain), then the mouth point inside that box
    const hw = hero.offsetWidth, hh = hero.offsetHeight, nr = hero.naturalWidth / hero.naturalHeight;
    let iw = hw, ih = hh; if (hw / hh > nr) iw = hh * nr; else ih = hw / nr;
    const m = CC.assets.mouth(CC.hero ? CC.hero.cur() : 'idle');
    const mx = hero.offsetLeft + (hw - iw) / 2 + iw * m.x, my = hero.offsetTop + (hh - ih) / 2 + ih * m.y;
    const bx = bub.offsetLeft, by = bub.offsetTop, bw = bub.offsetWidth, bh = bub.offsetHeight;
    // nearest point on the bubble's border to the mouth, and the angle from there to the mouth
    const px = Math.max(bx + 14, Math.min(bx + bw - 14, mx)), py = Math.max(by + 14, Math.min(by + bh - 14, my));
    // the mouth is to the side of the bubble in the skin-3 layout: aim from the side edge when it is beside the bubble, else from the nearer of top / bottom
    let ex, ey;
    if (mx < bx) { ex = bx; ey = py; } else if (mx > bx + bw) { ex = bx + bw; ey = py; } else if (my < by + bh / 2) { ex = px; ey = by; } else { ex = px; ey = by + bh; }
    const ang = Math.atan2(my - ey, mx - ex) * 180 / Math.PI - 90;     // tail triangle points "up" by default
    tail.style.left = (ex - bx) + 'px'; tail.style.top = (ey - by) + 'px'; tail.style.transform = 'translate(-50%,-50%) rotate(' + ang.toFixed(1) + 'deg) translateY(-4px)';
  }
  function say(group, text) {
    const bub = document.getElementById('cap'), p = document.getElementById('capT'); if (!bub) return;
    const t = text || pickFrom(group, last); if (t === curText) return; last = curText = t;
    p.textContent = t; bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    fit();   // once per line
  }
  CC.caption = { say, fit, LINES };
})();
