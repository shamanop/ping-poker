#!/usr/bin/env python3
"""8-seat clipping/overlap + bet-chip vs hero-card overlap. Server on :3113."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.abspath(__file__)); URL = 'http://localhost:3113/'
src = open(os.path.join(ROOT, 'run.py')).read()
OPP = src.split('OPP = """')[1].split('"""')[0]
CHECKS = src.split('CHECKS = """')[1].split('"""')[0]
OVL = """() => {
  const R = e => e.getBoundingClientRect(); const I = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const bets = [...document.querySelectorAll('#bet-layer > *')].filter(e => R(e).width);
  const hero = [...document.querySelectorAll('#hole-cards .card')]; const seats = [...document.querySelectorAll('#player-seats > *')].filter(e => R(e).width);
  const out = [];
  bets.forEach((b, i) => { const br = R(b);
    hero.forEach((c, j) => { if (I(br, R(c))) out.push(['bet', i, 'x hero card', j, b.className.slice(0,30), [br.left|0, br.top|0, br.right|0, br.bottom|0], (b.textContent||'').trim().slice(0,10)]); });
    seats.forEach((s, j) => { if (I(br, R(s))) out.push(['bet', i, 'x seat', j, b.className.slice(0,30), (b.textContent||'').trim().slice(0,10)]); });
    bets.forEach((b2, k) => { if (k > i && I(br, R(b2))) out.push(['bet', i, 'x bet', k]); });
  });
  const puck = document.querySelector('#puck-layer > *'); if (puck) { const pr = R(puck); seats.forEach((s, j) => { if (I(pr, R(s))) out.push(['puck x seat', j]); }); hero.forEach((c, j) => { if (I(pr, R(c))) out.push(['puck x herocard', j]); }); }
  return { n: bets.length, out };
}"""
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); open(os.path.join(ROOT, 'run2.log'), 'a').write(s + '\n')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h) in [(1440, 900), (1920, 1080)]:
        log('==', w, h)
        ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
        p.on('console', lambda m: log('  [console]', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
        p.on('pageerror', lambda e: log('  [pageerror]', str(e)[:300]))
        p.on('response', lambda r: log('  [http]', r.status, r.url[-80:]) if r.status >= 400 else None)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
        p.fill('#player-name', 'Hero8'); p.fill('#password-input', 'ping'); p.click('#btn-join')
        p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
        ctx2 = b.new_context(viewport={'width': 1280, 'height': 800}); op = ctx2.new_page(); op.goto(URL, wait_until='load'); op.wait_for_timeout(500)
        av = ['🦊', '🐙', '🦅', '🐺', '🐲', '🦁', '🎲']
        for i in range(7): op.evaluate(OPP, [f'Bot{i+1}', av[i]])
        p.wait_for_timeout(1200)
        log('  lobby count', p.evaluate("() => document.getElementById('lobby-count').textContent"))
        log('  lobby check', json.dumps({k: v for k, v in p.evaluate(CHECKS).items() if k in ('docScroll',)}))
        p.screenshot(path=f'{ROOT}/{w}x{h}-30-lobby-8.png')
        p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(2200)
        p.screenshot(path=f'{ROOT}/{w}x{h}-31-dealt-8.png')
        c = p.evaluate(CHECKS)
        log('  8-seat dealt: seatsClipped', json.dumps(c['seatsClipped']), 'overlaps', json.dumps(c['overlaps'])[:1200], 'docScroll', c['docScroll'], 'barVisible', c['barVisible'], 'textOverflow', json.dumps(c['textOverflow'])[:500])
        log('  seats', json.dumps(c['seats']))
        t0 = time.time(); seen = set()
        while time.time() - t0 < 100:
            g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, street: gs?.street, sd: !document.getElementById('showdown-overlay').classList.contains('hidden'), ctl: !document.getElementById('btn-check-call').disabled } }""")
            if g['sd']:
                p.wait_for_timeout(800); c = p.evaluate(CHECKS); p.screenshot(path=f'{ROOT}/{w}x{h}-32-showdown-8.png')
                log('  8-seat showdown: clipped', json.dumps(c['seatsClipped']), 'overlaps', json.dumps(c['overlaps'])[:1500]); break
            if g['ctl'] and g['cur'] == g['my'] and g['st'] == 'playing':
                p.wait_for_timeout(500)
                if g['street'] not in seen:
                    seen.add(g['street']); c = p.evaluate(CHECKS)
                    log(f"  8-seat myturn-{g['street']}: clipped", json.dumps(c['seatsClipped']), 'overlaps', json.dumps(c['overlaps'])[:900], 'bar', c['barVisible'], c['docScroll'])
                    log('   bets/pucks', json.dumps(p.evaluate(OVL)))
                    if g['street'] == 'preflop': p.screenshot(path=f'{ROOT}/{w}x{h}-33-myturn-8.png')
                # do a raise preflop to put chips out, else call
                if g['street'] == 'preflop' and 'raised' not in seen:
                    seen.add('raised'); p.click('#raise-presets .pre:nth-child(2)'); p.click('#btn-raise')
                    p.wait_for_timeout(1500); log('   after raise bets', json.dumps(p.evaluate(OVL))); continue
                p.click('#btn-check-call'); p.wait_for_timeout(700)
            else: p.wait_for_timeout(250)
        ctx2.close(); ctx.close()
    b.close()
