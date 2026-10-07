// FB2 measure + shots: node measure.js PORT LABEL  (run under flock). Writes qa/coldcall-fb1/fb2fb3/<LABEL>_*.png and <LABEL>_measure.json
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PORT = process.argv[2] || '4650', LABEL = process.argv[3] || 'before', OUT = __dirname;
const SIZES = [[360, 740], [540, 960], [1440, 900]];
const STATES = [['idle', 'play'], ['idle', 'chips'], ['callback', 'play'], ['gain', 'play']];
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const res = [];
  for (const [w, h] of SIZES) for (const [state, mode] of STATES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/games/coldcall/index.html?mock=pull&state=${state}&mode=${mode}&nosplash`, { waitUntil: 'load' });
    await page.waitForTimeout(state === 'gain' ? 700 : 2500);
    const m = await page.evaluate(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), b: +b.bottom.toFixed(1) }; };
      const note = document.getElementById('plNote'), nb = note.getBoundingClientRect(), cells = [...document.querySelectorAll('#slots i')].map((c) => c.getBoundingClientRect());
      const syms = [...document.querySelectorAll('#reels .cell, #reels img, #reels > *')].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 5);
      const top = cells.length ? Math.min(...cells.map((c) => c.top)) : null; const symTop = syms.length ? Math.min(...syms.map((c) => c.top)) : null;
      const ov = (a) => a.some((c) => !(c.right <= nb.left || c.left >= nb.right || c.bottom <= nb.top || c.top >= nb.bottom));
      const sc = document.getElementById('stage').getBoundingClientRect().width / 540;
      const cs = getComputedStyle(note);
      return { hidden: note.hidden, note: r(note), scale: +sc.toFixed(3), noteStageH: +(nb.height / sc).toFixed(1), board: r(document.getElementById('board')), gain: r(document.getElementById('plGain')), gainHidden: document.getElementById('plGain').hidden, cellsTop: top, symTop, overlapsCell: ov(cells), overlapsSymbol: ov(syms), nCells: cells.length, nSyms: syms.length, cold: (document.getElementById('plCold') || {}).textContent, text: note.innerText.replace(/\n/g, ' | '), fontMin: Math.min(...[...note.querySelectorAll('small,b,em,.cold')].map((e) => parseFloat(getComputedStyle(e).fontSize))) * sc, overflowX: [...note.querySelectorAll('.cold,.r1')].some((e) => e.scrollWidth > e.clientWidth + 1) };
    });
    const tag = `${LABEL}_${w}_${state}_${mode}`; m.tag = tag; res.push(m);
    await page.screenshot({ path: path.join(OUT, tag + '.png'), clip: { x: 0, y: 0, width: w, height: Math.min(h, 520) } });
    if (state === 'idle' && mode === 'play') {   // worst-case text: 4-digit count, longest cold line the code can print
      m.worst = await page.evaluate(() => { document.getElementById('plN').textContent = '3,125'; const c = document.getElementById('plCold'); c.className = 'cold long'; c.innerHTML = '<u>112 leads</u> + 12 warm go cold in 1 d 23 h'; return { clipped: c.scrollWidth > c.clientWidth + 1, scrollW: c.scrollWidth, clientW: c.clientWidth, text: c.textContent }; });
      await page.screenshot({ path: path.join(OUT, tag + '_worst.png'), clip: { x: 0, y: 0, width: w, height: Math.min(h, 520) } });
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, LABEL + '_measure.json'), JSON.stringify(res, null, 1));
  for (const m of res) console.log(m.tag.padEnd(28), 'noteH', m.note && m.note.h, 'stageH', m.noteStageH, 'bottom', m.note && m.note.b, 'symTop', m.symTop && +m.symTop.toFixed(1), 'ovCell', m.overlapsCell, 'ovSym', m.overlapsSymbol, 'minFont', +m.fontMin.toFixed(1), 'overX', m.overflowX, m.worst ? 'worstClipped ' + m.worst.clipped + ' ' + m.worst.scrollW + '/' + m.worst.clientW : '', '|', m.text);
  await browser.close();
})();
