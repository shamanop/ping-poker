const { launch, sleep } = require('./lib');
(async () => {
  const b = await launch(); const { page } = b; const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  try {
    await page.goto('http://127.0.0.1:4610/games/coldcall/index.html'); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 30000 }); await sleep(1000);
    const r = await page.evaluate(() => { const A = CC.assets, man = A.man; const urls = new Set([...Object.keys(man.symbols).map(A.symUrl), A.heroUrl(), A.bgUrl(), ...Object.keys(man.hero.moods).map(A.moodUrl), ...Object.keys(man.pieces).map(A.pieceUrl), ...Object.keys(man.textures).map(A.texUrl)]); const decoded = [...urls].filter((u) => A.imgs.has(u) && A.imgs.get(u).complete && A.imgs.get(u).naturalWidth > 0).length; return { manifestImages: urls.size, decoded, warn: A.warn, fonts: [...document.fonts].map((f) => f.family + ':' + f.status), audioEls: document.querySelectorAll('audio').length, symbolsInManifest: Object.keys(man.symbols).length, engineSyms: ColdCallEngine.SYM.length, splash: !!document.getElementById('splash') }; });
    console.log(JSON.stringify(r)); console.log('bad responses:', JSON.stringify(bad));
  } finally { await b.browser.close(); }
})();
