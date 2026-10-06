const { launch, base, sleep } = require('./skin_lib');
(async () => {
  const b = await launch(); const { page } = b; const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); }); page.on('requestfailed', (r) => bad.push('FAILED ' + r.url()));
  try {
    await page.goto(base + '?live=1&name=qa9&pin=4321'); await page.waitForFunction(() => window.CC && CC.ready); await sleep(500);
    console.log(JSON.stringify(await page.evaluate(() => ({ imgs: CC.assets.imgs.size, undecoded: [...CC.assets.imgs.values()].filter((i) => !i.complete || !i.naturalWidth).length, warn: CC.assets.warn, fonts: [...document.fonts].map((f) => f.family + ':' + f.status), cssVars: ['--img-bg', '--img-spin', '--img-seal', '--img-wood'].map((v) => !!getComputedStyle(document.documentElement).getPropertyValue(v)), audio: document.querySelectorAll('audio').length, heroSizes: [...CC.assets.imgs.entries()].filter(([u]) => /hero/.test(u)).map(([u, i]) => u.split('/').pop() + ':' + i.naturalWidth + 'x' + i.naturalHeight) }))));
    // hero box identical for every mood + tail follows mouth
    const rows = []; for (const m of ['idle', 'hype', 'shock', 'win', 'rage']) { await page.evaluate((m) => { CC.hero.set(m, 0); CC.caption.fit(); }, m); rows.push(await page.evaluate((m) => { const h = document.getElementById('hero'), t = document.getElementById('capTail'); return { m, box: [h.offsetLeft, h.offsetTop, h.offsetWidth, h.offsetHeight].join(','), nat: h.naturalWidth, tail: t.style.left + '/' + t.style.top + '/' + t.style.transform.match(/rotate\(([-\d.]+)deg/)[1] + 'deg', mouth: JSON.stringify(CC.assets.mouth(m)) }; }, m)); }
    console.log(rows.map((r) => JSON.stringify(r)).join('\n')); console.log('bad responses:', JSON.stringify(bad));
  } finally { await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
