#!/usr/bin/env python3
"""Recap browser leg. Usage: python3 qa/port-recap/shoot.py <port> <tables.json> [WxH ...]
Needs a dev server (RIG=1 SIGNUP_PLAY_CENTS=1000000) and `node qa/port-recap/bots.js <port> <tables.json>` running.
One human (Ann) plays the chips table and the Play $ table, then opens the recap from the table bar, the Bank header and the night-end screen."""
import json, os, sys
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); TABLES = sys.argv[2]
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[3:]] or [(360, 740), (540, 900), (1440, 900)]
OUT = os.path.dirname(os.path.abspath(__file__))
URL = f'http://127.0.0.1:{PORT}/'
tables = json.load(open(TABLES))
problems = []
seen_kinds = set()
def note(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True)
def overflow(p, tag):
    r = p.evaluate("""() => { const o = document.getElementById('rc-root'); if (!o || !o.classList.contains('open')) return null;
      const bad = []; const vw = document.documentElement.clientWidth;
      const sheet = o.querySelector('.rc-sheet'); const sr = sheet.getBoundingClientRect();
      o.querySelectorAll('.rc-sheet *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > sr.right + 1 || r.left < sr.left - 1) && !e.closest('.rc-scroll') ) bad.push((e.className || e.tagName) + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); });
      const sx = [...o.querySelectorAll('.rc-sheet, .rc-body, .rc-col, .rc-card, .rc-scroll')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
      return { vw, docScroll: document.documentElement.scrollWidth > vw + 1, outside: bad.slice(0, 6), hscroll: sx.slice(0, 6) }; }""")
    if r and (r['docScroll'] or r['outside'] or r['hscroll']):
        problems.append((tag, r)); note('  OVERFLOW', tag, json.dumps(r))
    return r
SIGNIN = """async ([name]) => { const s = window.PingSocket; const wait = (ev) => new Promise(r => s.once(ev, r));
  const p1 = Promise.race([wait('auth_ok'), wait('auth_error')]); s.emit('auth_signup', { name, pin: '1234', avatar: 'a02' }); let r = await p1;
  if (r && r.code === 'name_taken') { const p2 = Promise.race([wait('auth_ok'), wait('auth_error')]); s.emit('auth_login', { name, pin: '1234' }); r = await p2; }
  return !!(r && r.account); }"""
AUTOPLAY = """(tid) => { const s = window.PingSocket; if (window.__auto) s.off('game_state', window.__auto); let last = '';
  window.__hands = window.__hands || 0; if (!window.__shd) { window.__shd = true; s.on('showdown_result', () => { window.__hands++; }); }
  window.__auto = (gs) => { if (gs.status !== 'playing' || gs.paused) return; const me = gs.players.findIndex(p => p.name === 'Ann'); if (me < 0 || gs.currentPlayerIdx !== me) return;
    const sig = gs.handNum + '|' + gs.street + '|' + gs.currentBet + '|' + gs.pot; if (sig === last) return; last = sig; const toCall = gs.currentBet - gs.players[me].roundBet;
    const raise = gs.street === 'preflop' && toCall <= gs.bb && gs.handNum % 4 === 2 && gs.players[me].chips > gs.bb * 6;
    setTimeout(() => s.emit('player_action', raise ? { roomId: tid, action: 'raise', amount: gs.bb * 3 } : { roomId: tid, action: toCall > 0 ? 'call' : 'check' }), 300); };
  s.on('game_state', window.__auto); }"""
def clear_modals(p):
    # a brand-new account gets the daily streak calendar; close it the way a player would (Escape, then its own button)
    for _ in range(3):
        if not p.locator('.pj-modal.open').count(): return
        p.keyboard.press('Escape'); p.wait_for_timeout(200)
        if p.locator('.pj-modal.open').count():
            b = p.locator('.pj-modal.open button').last
            try: b.click(timeout=1500)
            except Exception: pass
            p.wait_for_timeout(300)
def shot(p, name):
    path = f'{OUT}/{name}.jpg'
    p.screenshot(path=path, type='jpeg', quality=62); note('  shot', os.path.basename(path))
def play_table(b, w, h, kind):
    t = tables[kind]; tag = f'{w}x{h}-{kind}'
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('pageerror', lambda e: (problems.append((tag, 'pageerror ' + str(e)[:160])), note('  PAGEERROR', str(e)[:160])))
    p.on('console', lambda m: note('  [console.error]', m.text[:140]) if m.type == 'error' else None)
    p.goto(URL, wait_until='load'); p.wait_for_function("window.PingSocket && window.PingSocket.connected", timeout=10000)
    assert p.evaluate(SIGNIN, ['Ann']), 'sign in failed'
    p.wait_for_timeout(600)
    fund = 'chips' if kind == 'chips' else 'play'
    p.evaluate("([tid, kind]) => window.PingSocket.emit('table_join', { tableId: tid, buyIn: kind === 'chips' ? 3000 : 20000 })", [t['id'], kind])
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=10000)
    p.evaluate(AUTOPLAY, t['id'])
    need = 1 if kind in seen_kinds else 6
    p.wait_for_function("window.__hands >= %d" % need, timeout=180000); seen_kinds.add(kind)
    p.wait_for_timeout(500); clear_modals(p)
    shot(p, f'{tag}-1-table')
    # --- entry 1: table bar
    p.wait_for_selector('#rc-table-btn:not(.hidden)', timeout=5000)
    clear_modals(p); p.click('#rc-table-btn'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(400)
    note('  hands in recap:', p.locator('.rc-hand').count())
    shot(p, f'{tag}-2-recap-table-entry'); overflow(p, tag + '-overview')
    # replay: step through
    p.locator('.rc-hand').first.click(); p.wait_for_timeout(200)
    for _ in range(4):
        p.click('#rc-next'); p.wait_for_timeout(120)
    p.locator('#rc-replay').scroll_into_view_if_needed(); p.wait_for_timeout(200)
    shot(p, f'{tag}-3-replay-step4'); overflow(p, tag + '-replay')
    for _ in range(14):
        if p.locator('#rc-next').is_disabled(): break
        p.click('#rc-next'); p.wait_for_timeout(60)
    shot(p, f'{tag}-4-replay-end'); overflow(p, tag + '-replay-end')
    # share card
    p.evaluate("document.getElementById('rc-share').scrollIntoView()")
    p.click('#rc-share'); p.wait_for_selector('#rc-card-img', timeout=10000); p.wait_for_timeout(500)
    shot(p, f'{tag}-5-share-card'); overflow(p, tag + '-share')
    if (w, h) == SIZES[-1] or w == 1440:
        png = p.evaluate("() => window.Recap.cardDataUrl()")
        import base64; open(f'{OUT}/{tag}-share-card.png', 'wb').write(base64.b64decode(png.split(',')[1]))
    p.click('#rc-card-close'); p.keyboard.press('Escape'); p.wait_for_timeout(200)
    # --- entry 2: Bank header
    p.click('#bank-btn'); p.wait_for_selector('#rc-bank-btn:not(.hidden)', timeout=5000); p.wait_for_timeout(600)
    shot(p, f'{tag}-6-bank-header')
    p.click('#rc-bank-btn'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(300)
    shot(p, f'{tag}-7-recap-bank-entry'); overflow(p, tag + '-bank-entry')
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    assert not p.evaluate("document.getElementById('rc-root').classList.contains('open')"), 'recap did not close'
    p.click('#bank-close'); p.wait_for_timeout(200)
    # --- entry 3: night-end screen (night_get shows the settle-up view for the live night)
    p.evaluate("() => window.PingSocket.emit('table_leave', { tableId: '%s' })" % t['id']); p.wait_for_timeout(1200)
    p.evaluate("(nid) => window.PingSocket.emit('night_get', { nightId: nid })", t['nightId'])
    p.wait_for_selector('.lb-settle #lb-recap', timeout=10000); p.wait_for_timeout(400)
    shot(p, f'{tag}-8-settle-screen')
    p.click('#lb-recap'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(300)
    shot(p, f'{tag}-9-recap-settle-entry'); overflow(p, tag + '-settle-entry')
    ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    try:
        for (w, h) in SIZES:
            note('==', w, h)
            for kind in ('chips', 'play'):
                play_table(b, w, h, kind)
    finally:
        b.close()
note('PROBLEMS', len(problems))
for pr in problems: note('  ', pr)
sys.exit(1 if problems else 0)
