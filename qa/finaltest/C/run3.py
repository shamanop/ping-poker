import json, os, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.abspath(__file__)); URL = 'http://localhost:3113/'
src = open(os.path.join(ROOT, 'run.py')).read(); OPP = src.split('OPP = """')[1].split('"""')[0]
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); open(os.path.join(ROOT, 'run3.log'), 'a').write(s + '\n')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    w, h = 1440, 900
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('console', lambda m: log('  [console]', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: log('  [pageerror]', str(e)[:300]))
    p.on('response', lambda r: log('  [http]', r.status, r.url[-80:]) if r.status >= 400 else None)
    p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
    p.fill('#player-name', 'HotKey'); p.fill('#password-input', 'ping'); p.click('#btn-join')
    p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
    ctx2 = b.new_context(); op = ctx2.new_page(); op.goto(URL, wait_until='load'); op.wait_for_timeout(400)
    op.evaluate(OPP, ['Bob', '🦊']); op.evaluate(OPP, ['Carla', '🐙']); p.wait_for_timeout(900)
    p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
    t0 = time.time(); done = False
    while time.time() - t0 < 60 and not done:
        g = p.evaluate("() => ({ ctl: !document.getElementById('btn-check-call').disabled, cur: state.gameState?.currentPlayerIdx, my: state.myIdx, mode: state.barMode })")
        if g['ctl'] and g['cur'] == g['my']:
            p.wait_for_timeout(500)
            # typing in chat must NOT trigger hotkeys
            p.click('.rail-tab[data-tab="chat"]'); p.click('#chat-input'); p.keyboard.type('fcr'); p.wait_for_timeout(200)
            st = p.evaluate("() => ({ foldDis: document.getElementById('btn-fold').disabled, mode: state.barMode, chat: document.getElementById('chat-input').value })")
            log('  typing fcr in chat ->', st)
            p.evaluate("() => document.activeElement.blur()"); p.click('.rail-tab[data-tab="log"]')
            p.keyboard.press('f'); p.wait_for_timeout(900)
            log('  F hotkey ->', p.evaluate("() => ({ mode: state.barMode, folded: state.gameState.players[state.myIdx].folded, last: [...document.querySelectorAll('#log-entries *')].map(e => e.textContent).filter(t => /HotKey folds/.test(t)).pop() })"))
            done = True
        else: p.wait_for_timeout(250)
    # fonts + 10 glyph extents
    p.wait_for_timeout(1500)
    log('  fonts loaded', p.evaluate("() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)"))
    res = p.evaluate("""() => { const out = []; const wrap = document.createElement('div'); wrap.id = '__t'; wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#14231a;display:flex;gap:14px;padding:20px;align-items:flex-start'; document.body.appendChild(wrap);
      for (const sz of ['sm', 'md', 'lg']) { wrap.insertAdjacentHTML('beforeend', faceCardHtml({rank: '10', suit: '♠'}, sz)); const card = wrap.lastElementChild; const t = card.querySelector('text'); const e0 = t.getExtentOfChar(0), e1 = t.getExtentOfChar(1); const cr = card.getBoundingClientRect(); out.push({sz, cardW: Math.round(cr.width), ch0: [e0.x, e0.x + e0.width], ch1: [e1.x, e1.x + e1.width], advGap: e1.x - (e0.x + e0.width), textW: t.getBBox().width, cardUnits: 100, fontFam: getComputedStyle(t).fontFamily.slice(0, 50)}); }
      const r = []; wrap.remove(); return out; }""")
    for r in res: log('  10 extents', json.dumps(r))
    # pixel gap between '1' and '0' at lg: render & analyse columns
    p.evaluate("""() => { const wrap = document.createElement('div'); wrap.id = '__t2'; wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#fff;padding:10px'; wrap.innerHTML = faceCardHtml({rank: '10', suit: '♠'}, 'lg'); document.body.appendChild(wrap); }""")
    p.wait_for_timeout(300)
    box = p.locator('#__t2 .card').bounding_box()
    p.screenshot(path=f'{ROOT}/10-lg.png', clip={'x': box['x'], 'y': box['y'], 'width': box['width'] * 0.4, 'height': box['height'] * 0.22})
    from PIL import Image
    im = Image.open(f'{ROOT}/10-lg.png').convert('L'); W, H = im.size
    cols = [any(im.getpixel((x, y)) < 110 for y in range(H)) for x in range(W)]
    runs = []; cur = None
    for x, c in enumerate(cols):
        if c and cur is None: cur = x
        if not c and cur is not None: runs.append((cur, x - 1)); cur = None
    if cur is not None: runs.append((cur, W - 1))
    log('  10 dark-pixel column runs (x ranges) in index crop', runs, 'size', im.size)
    ctx2.close(); ctx.close(); b.close()
