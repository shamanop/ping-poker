/* COLD CALL art loader. Every image the game draws comes from assets/symbols.json (id -> file), plus one hero and one background slot.
   Swapping final art = replace files / edit that JSON. Nothing in the code names a file. */
(() => {
  const CC = (window.CC = window.CC || {});
  const BASE = new URL('assets/', document.baseURI).href;
  const A = (CC.assets = { man: null, imgs: new Map(), ready: false, warn: [] });
  const abs = (p) => new URL(p, BASE).href;
  A.symUrl = (id) => (A.man && A.man.symbols[id] ? abs(A.man.symbols[id]) : '');
  A.heroUrl = () => (A.man ? abs(A.man.hero.file) : '');
  A.bgUrl = () => (A.man ? abs(A.man.background.file) : '');
  A.mouth = () => (A.man && A.man.hero.mouth) || { x: 0.5, y: 0.3 };
  // preload + decode every image once (during the splash) so the first spin never hitches. onStep(done, total) for the splash label.
  A.load = async (onStep) => {
    const man = await (await fetch(BASE + 'symbols.json', { cache: 'no-cache' })).json();
    A.man = man;
    const urls = [...new Set([...Object.keys(man.symbols).map(A.symUrl), A.heroUrl(), A.bgUrl()])];
    let done = 0;
    await Promise.all(urls.map(async (u) => {
      const im = new Image(); im.decoding = 'sync'; im.src = u;
      try { await im.decode(); } catch (e) { A.warn.push('decode failed: ' + u); }
      // raster art should be about 2x the display size (cell ~94 css px => 188+ px); vectors are fine at any size
      if (!/\.svg(\?|$)/i.test(u) && im.naturalWidth && im.naturalWidth < 150 && u !== A.bgUrl()) A.warn.push('low-res art (' + im.naturalWidth + 'px): ' + u);
      A.imgs.set(u, im); done++; if (onStep) onStep(done, urls.length);
    }));
    A.ready = true;
    if (A.warn.length) console.info('[coldcall assets]', A.warn.join('; '));
    return man;
  };
  A.img = (id, cls) => { const im = document.createElement('img'); im.src = A.symUrl(id); im.alt = ''; im.draggable = false; im.decoding = 'sync'; if (cls) im.className = cls; return im; };
})();
