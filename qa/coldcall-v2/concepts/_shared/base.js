/* Concept-comp harness: builds the live skin-3 skeleton (same ids, same CSS, same art) with a static mock board.
   URL: ?state=idle|callback|pick|more|ghost|pot   (&w= &h= viewport, used for the stage fit exactly like game.js fit()). */
(() => {
  const Q = new URLSearchParams(location.search), state = Q.get('state') || 'idle';
  const R = '/public/games/coldcall/', $ = (id) => document.getElementById(id);
  const M = (window.MOCK = { state, Q, $, R, S: null, CELL: 64, PAD: 8 });

  // ---- shared numbers (the same on every concept, so the comps compare layout and not content)
  M.num = { leads: 43, max: 400, cold: '20 leads go cold in 3 h 12 m', coldN: 20, coldT: '3 h 12 m', bet: '$1.00', cbBet: '$2.00', pot: '$1,284.50', day: 4, dailyLeads: 30,
    feed: [['MATT', 'just closed 2,400x'], ['DANI', 'took a CALLBACK at $5.00'], ['YOU', 'closed 37x'], ['JOE', 'took THE POT $912.00']],
    bank: '$35.84', gamble: '$71.68', pWin: '49%', ghost: '$12.40', potWin: '+$1,284.50' };

  // ---- the mock board: 6x5, ids from symbols.json
  const GRID = ['headset','pile','closer','note','cash','can',  'cups','mug','ball','rx','pile','note',  'cash','headset','pile','can','cups','cash',  'note','mug','headset','rx','cashwad','pile',  'can','cups','pile','headset','note','cash'];
  const BONUS_GRID = ['can','pile','mug','headset','cash','cups',  'closer','phone','pile','note','ball','rx',  'cups','headset','phone','mug','can','pile',  'pile','cash','headset','phone','closer','note',  'mug','can','cups','pile','headset','cash'];
  const DEAD_GRID = ['mug','pile','can','headset','cups','rx',  'closer','headset','note','pile','mug','can',  'cups','can','cash','closer','headset','pile',  'rx','pile','mug','note','can','cups',  'headset','closer','pile','cups','rx','mug'];
  M.warm = [3, 8, 19, 26];            // idle: 4 warm squares, all tied to the $1.00 bet
  M.hot = { pick: [7, 14, 21], ghost: [4, 13, 22] };
  M.ghostAmt = { 4: '$2.20', 13: '$6.80', 22: '$3.40' };   // sums to $12.40

  const html = `<div id="app"><div id="stage">
  <div id="bgslot"></div>
  <div id="shake">
    <section id="head"><img id="hero" alt=""><i id="ttl"></i><div id="cap"><p id="capT"></p><i id="capTail"></i></div>
      <div id="bh" hidden><div class="chip"><small>SPINS LEFT</small><b id="bhLeft">0</b></div><div class="chip"><small id="bhTotL">BONUS TOTAL</small><b id="bhTot">$0</b></div></div></section>
    <div id="ribbon"><span id="ribL">5+ touching = win</span><span class="r" id="ribR">MAX 10,000X</span></div>
    <div id="board"><div class="slots" id="slots"></div><div id="reels"></div><div id="ovl"></div><div id="floats"></div></div>
    <div id="scene"></div>
    <div id="winbox"><span class="lbl">WIN</span><span id="win">$0.00</span></div>
    <div id="hud">
      <div class="meter" id="balM"><span class="lbl" id="balL">BALANCE</span><span class="val" id="bal">$1,000.00</span></div>
      <button id="spin" class="idle"><span>SPIN</span></button>
      <div class="meter" id="betM"><span class="lbl">BET</span><div class="row"><button class="sq" id="betDn">-</button><span class="val" id="bet">$1.00</span><button class="sq" id="betUp">+</button></div></div>
      <div class="btns"><button id="buy"><b>BUY BONUS</b><span id="buyFrom">from $2.90</span></button><button id="auto">AUTO</button><button id="turbo">TURBO</button><button id="info">i</button>
        <button id="sfxBtn" class="tog"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z"/><path class="w" d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><em>SFX</em></button>
        <button id="musicBtn" class="tog"><svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="3"/><circle cx="17.5" cy="16" r="3"/></svg><em>MUSIC</em></button></div>
      <div class="fine" id="fine">No deposits, no payouts. Chips are your poker bank.</div>
    </div>
  </div>
  <div id="ov"></div>
  <div id="modebar"><div class="mb"><button data-m="play" class="on">Play $</button><button data-m="chips">Chips</button></div><span id="modenote">Pretend money.</span></div>
</div></div>`;

  M.el = (tag, cls, h, attrs) => { const e = document.createElement(tag); if (cls) e.className = cls; if (h != null) e.innerHTML = h; if (attrs) Object.entries(attrs).forEach(([k, v]) => e.style.setProperty(k, v)); return e; };
  M.sym = (id) => M.S.symbols[id] ? R + 'assets/' + M.S.symbols[id] : '';
  M.xy = (p) => [M.PAD + (p % 6) * M.CELL, M.PAD + ((p / 6) | 0) * M.CELL];       // inside #reels / #ovl (same box)
  M.cellEl = (cls, p) => { const e = M.el('div', cls); const [x, y] = M.xy(p); e.style.left = x + 'px'; e.style.top = y + 'px'; return e; };
  M.say = (t) => { $('capT').innerHTML = t; M.tail(); };
  M.mood = (m) => { M.moodName = m; const f = m === 'idle' ? M.S.hero.file : M.S.hero.moods[m].file; $('hero').src = R + 'assets/' + f; };
  M.tail = () => {                                   // captions.js fit(), verbatim math
    const bub = $('cap'), hero = $('hero'), tail = $('capTail'); if (!hero.naturalWidth) return;
    const hw = hero.offsetWidth, hh = hero.offsetHeight, nr = hero.naturalWidth / hero.naturalHeight; let iw = hw, ih = hh; if (hw / hh > nr) iw = hh * nr; else ih = hw / nr;
    const m = (M.moodName && M.moodName !== 'idle' && M.S.hero.moods[M.moodName].mouth) || M.S.hero.mouth;
    const mx = hero.offsetLeft + (hw - iw) / 2 + iw * m.x, my = hero.offsetTop + (hh - ih) / 2 + ih * m.y;
    const bx = bub.offsetLeft, by = bub.offsetTop, bw = bub.offsetWidth, bh = bub.offsetHeight;
    const px = Math.max(bx + 14, Math.min(bx + bw - 14, mx)), py = Math.max(by + 14, Math.min(by + bh - 14, my)); let ex, ey;
    if (mx < bx) { ex = bx; ey = py; } else if (mx > bx + bw) { ex = bx + bw; ey = py; } else if (my < by + bh / 2) { ex = px; ey = by; } else { ex = px; ey = by + bh; }
    const ang = Math.atan2(my - ey, mx - ex) * 180 / Math.PI - 90;
    tail.style.left = (ex - bx) + 'px'; tail.style.top = (ey - by) + 'px'; tail.style.transform = 'translate(-50%,-50%) rotate(' + ang.toFixed(1) + 'deg) translateY(-4px)';
  };
  M.fit = () => {                                     // game.js fit(), verbatim math
    const H = Math.max(960, Math.min(1250, Math.round(540 * innerHeight / innerWidth))), s = Math.min(innerWidth / 540, innerHeight / H);
    $('stage').style.setProperty('--H', H + 'px'); $('app').style.setProperty('--s', s); M.H = H; M.s = s; M.tail();
  };
  // a symbol cell, a hot (lit) square, a warm square
  M.cell = (id, p) => { const c = M.cellEl('cell', p); const im = M.el('img', 'sym'); im.src = M.sym(id); c.appendChild(im); return c; };
  M.hotSq = (p, cls = '') => { const s = $('slots').children[p]; s.classList.add('hot', 'still'); if (cls) s.classList.add(cls); };
  M.bonusUi = (left, total, lbl) => { $('stage').classList.add('bonus'); $('bh').hidden = false; $('bhLeft').textContent = left; $('bhTot').textContent = total; if (lbl) $('bhTotL').textContent = lbl; };

  M.start = async (build) => {
    M.S = await (await fetch(R + 'assets/symbols.json')).json();
    document.body.innerHTML = html;
    const root = document.documentElement.style;
    root.setProperty('--img-bg', `url("${R}assets/${M.S.background.file}")`);
    Object.entries(M.S.pieces).forEach(([k, v]) => root.setProperty('--img-' + k, `url("${R}assets/${v}")`));
    Object.entries(M.S.textures || {}).forEach(([k, v]) => root.setProperty('--img-' + k, `url("${R}assets/${v}")`));
    await Promise.all((M.S.fonts || []).map((f) => document.fonts.load('16px "' + f + '"').catch(() => {})));
    const st = $('stage');
    // slots + grid
    $('slots').replaceChildren(...Array.from({ length: 30 }, (_, p) => { const i = document.createElement('i'); i.style.setProperty('--rot', ((p * 7) % 5 - 2) * 0.9 + 'deg'); return i; }));
    const grid = state === 'pick' || state === 'more' ? BONUS_GRID : state === 'ghost' ? DEAD_GRID : GRID;
    grid.forEach((id, p) => $('reels').appendChild(M.cell(id, p)));
    // warm squares exist on idle / callback (the board has memory)
    M.hasWarm = state === 'idle' || state === 'callback';
    if (state === 'pick') M.hot.pick.forEach((p) => M.hotSq(p));
    if (state === 'ghost') M.hot.ghost.forEach((p) => M.hotSq(p));
    if (state === 'pick' || state === 'more') M.bonusUi(state === 'pick' ? 7 : 0, state === 'pick' ? '$11.20' : M.num.bank, 'BONUS TOTAL');
    if (state === 'more') $('win').textContent = M.num.bank;
    if (state === 'pick') $('win').textContent = '$11.20';
    M.mood('idle');
    await new Promise((r) => { const h = $('hero'); if (h.complete && h.naturalWidth) r(); else h.onload = r; });
    M.fit(); addEventListener('resize', M.fit);
    await build(M);
    M.fit();
    await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    document.body.dataset.ready = '1';
  };
})();
