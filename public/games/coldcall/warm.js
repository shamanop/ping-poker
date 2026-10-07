/* COLD CALL first-use warm-up (chris 10-06 FB5, "game is laggy").
   Measured on a real GPU (RTX 5090, shaman): steady state is clean at 60 Hz, but the FIRST time each effect is drawn the GPU process spends 5-17 ms per new raster program
   (Skia FillRRectOp / FillRectOp / CircularRRectOp / TextureOp compiles inside GrDrawingManager::flush), one frame of 50-117 ms at the first lit lead, the first big-win card, the first bonus intro.
   This file draws one of each of those looks, with the game's own classes and ids, in a ~invisible layer (opacity .02, pointer-events none) right after the game is ready, then removes it
   (about 0.5 s; the splash is still up for a real player). Nothing here reads or changes game state, money or the round machinery. CC.warm.run() is called from boot.js. */
(() => {
  const CC = (window.CC = window.CC || {});
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const symId = () => { const m = CC.assets && CC.assets.man; return (m && Object.keys(m.symbols)[0]) || 'mug'; };
  const img = (cls) => { const i = CC.assets.img(symId(), cls); return i; };
  function markup() {
    const h = [];
    // hot / cool lead squares (cyan, still, pull-gold ring) inside a .slots grid
    h.push('<div class="slots" style="position:absolute;left:8px;top:8px;--cols:6;--rows:1"><i class="hot" style="--rot:1.8deg"></i><i class="hot still" style="--rot:-0.9deg"></i><i class="hot still plg" style="--rot:0.9deg"></i><i class="cool" style="--rot:-1.8deg"></i><i class="hot pick" style="--rot:0deg"></i><i></i></div>');
    // winning cells: gold glow, sweep, ring, dim, under
    h.push('<div class="cell hit" style="left:8px;top:90px"></div><div class="cell sweep" style="left:80px;top:90px"></div><div class="cell ring" style="left:152px;top:90px"></div><div class="cell pulse" style="left:224px;top:90px"></div><div class="cell dim" style="left:296px;top:90px"></div>');
    // phone feature reveals: quote bubble with amount, upsell, card machine
    h.push('<div class="rv b t0" style="left:8px;top:170px"><img class="bub" alt=""><span class="amt" data-l="4">$12.5</span></div><div class="rv u" style="left:80px;top:170px"><b>x2</b></div><div class="rv c live" style="left:152px;top:170px"><i class="cm"></i><span class="cv">$25</span></div>');
    // bonus intro scene: lit glass panel, display text with stroke + shadow, readout chips, header phones
    h.push('<div class="scn rot" style="position:absolute;left:0;top:250px;width:360px;height:200px"><div class="hd"><i></i><h2>PLACE</h2><i></i></div><p class="sub">warm</p><div class="chips"><div class="chip set"><small>A</small><b>$0</b></div><div class="chip"><small>B</small><b>$0</b></div></div><div class="tap">TAP</div></div>');
    // big-win card at its real size and markup (game.js bigWin): the conic-ray backdrop, the winning hero, name + x with stroke and shadow, the count-up amount between two cash wads
    h.push('<div id="tierbg"></div><div id="tier"><div class="name">BIG WIN</div><div class="xx">x13.3</div><div class="amtw"><i class="cw l"></i><div class="amt">$0.00</div><i class="cw r"></i></div><div class="tap">TAP TO CONTINUE</div></div>');
    // every hero mood once (the image swaps on the first hot lead / shock / win; each is a new GPU texture the first time it is drawn)
    h.push('<div class="wh" style="position:absolute;left:0;top:0;width:540px;height:300px;display:flex">' + ['idle', 'hype', 'shock', 'rage', 'win'].map(() => '<img alt="" style="width:108px;height:108px;filter:drop-shadow(0 8px 6px rgba(0,0,0,.55))">').join('') + '</div>');
    // WIN readout (rounded plate, glowing count-up digits, pop) and the speech bubble with its tail: both repaint every frame of a count-up / caption change
    h.push('<div id="winbox" style="position:absolute;left:120px;top:900px;margin:0"><span class="lbl">WIN</span><span id="win" class="pop">$0.00</span></div><div id="cap" class="pop" style="right:auto;left:10px;top:720px"><p>warm</p><i id="capTail" style="left:30px;top:44px"></i></div>');
    // stamp, toast, float text, tag, seal
    h.push('<div class="stamp" style="left:120px;top:760px">BONUS!<i>3 BELLS</i></div><div class="toast" style="left:300px;top:740px;transform:none">warm</div><div class="float" style="left:60px;top:830px;transform:none">+<b>$5.00</b></div><div class="tag" style="left:300px;top:830px;transform:none">+2 LEADS</div><div class="accept" style="left:400px;top:700px"><i></i></div><div class="zap" style="left:420px;top:830px"></div><div class="fchip" style="left:420px;top:880px">warm</div>');
    // blur sweep: Skia builds one GPU blur program per kernel radius, so a drop-shadow / box-shadow whose blur changes while it animates (bpop, hit, slap) costs a ~17 ms compile on every NEW radius
    // (seen as three 17 ms FillRRectOp frames half a second into the first big-win card). Draw every radius once, static and animated.
    const B = []; for (let b = 1; b <= 8; b += 0.5) B.push(b); for (let b = 9; b <= 40; b += 1.5) B.push(b);
    h.push('<div style="position:absolute;left:380px;top:0;width:160px;display:flex;flex-wrap:wrap;gap:6px">' + B.map((b) => '<img alt="" class="sw" style="width:22px;height:22px;filter:drop-shadow(0 3px ' + b + 'px rgba(0,0,0,.6))"><i style="display:block;width:22px;height:22px;border-radius:5px;background:#789;box-shadow:0 2px ' + b + 'px rgba(0,0,0,.6)"></i>').join('') + '</div>');
    h.push('<img alt="" class="sw" style="position:absolute;left:60px;top:560px;width:60px;height:60px;filter:drop-shadow(0 10px 8px rgba(0,0,0,.6));animation:ccwsweep .9s linear both"><img alt="" class="sw" style="position:absolute;left:160px;top:560px;width:60px;height:60px;filter:drop-shadow(0 3px 2px rgba(0,0,0,.55));animation:ccwsweep .9s linear both"><i style="position:absolute;left:260px;top:560px;width:60px;height:60px;border-radius:8px;background:#789;box-shadow:0 0 14px rgba(255,208,88,.6);animation:ccwsweep .9s linear both"></i>');
    return h.join('');
  }
  async function run() {
    const st = CC.core && CC.core.st; if (CC.warm.done || !CC.assets || !CC.assets.ready || !st || st.busy || st.modal) return;   // a round or a card is already up (a driver that spins at once): skip, nothing to warm for
    const w = document.createElement('div'); w.id = 'ccwarm'; w.setAttribute('aria-hidden', 'true');
    w.style.cssText = 'position:fixed;left:0;top:0;width:540px;height:960px;overflow:hidden;opacity:.02;pointer-events:none;z-index:2147483000;contain:strict';
    w.innerHTML = '<style>@keyframes ccwsweep{from{transform:scale(.3)}to{transform:scale(1.7)}}</style>' + markup();
    w.querySelectorAll('img.sw').forEach((i) => { i.src = CC.assets.symUrl(symId()); });
    w.querySelectorAll('.cell').forEach((c) => c.appendChild(img('sym')));
    w.querySelectorAll('img.bub').forEach((i) => { i.src = CC.assets.symUrl('quote_bronze') || CC.assets.symUrl(symId()); });
    const tier = w.querySelector('#tier'); if (tier && CC.hero) tier.prepend(CC.hero.img('win', 'bwh'));
    w.querySelectorAll('.wh img').forEach((i, k) => { i.src = CC.assets.moodUrl(['idle', 'hype', 'shock', 'rage', 'win'][k]); });
    document.body.appendChild(w); try { performance.mark('ccwarm:start'); } catch (e) { /* marks are diagnostics only */ }
    const amt = w.querySelector('#tier .amt'), win = w.querySelector('#win'), digits = ['$0.00', '$1,234.56', '$78.90', '$3,456.78', '$9,012.34', '$567.89', '$12,345.67', '$0.00'];
    try { for (const d of digits) { if (st.busy) break; if (amt) amt.textContent = d; if (win) win.textContent = d; await raf2(); } if (!st.busy) await raf2(); if (!st.busy && CC.fx && CC.fx.warm) await CC.fx.warm(); await new Promise((r) => setTimeout(r, 150)); } finally { w.remove(); CC.warm.done = true; try { performance.mark('ccwarm:end'); } catch (e) { /* diagnostics only */ } }
  }
  CC.warm = { run, done: false };
})();
