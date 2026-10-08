#!/usr/bin/env python3
"""Port lead's own browser leg on the merged head: login form -> lobby -> radio on -> hands at a table -> night recap -> night-end screen.
Usage: python3 qa/port-lead/leg.py <port> <tables.json> [WxH ...]   (dev server with RIG=1 SIGNUP_PLAY_CENTS=1000000 + node qa/port-recap/bots.js running)
Driven through the UI: the sign-up form (ballot tabs + submit), the radio button, the Recap buttons. Driven through the socket: table_join, the player's actions."""
import json, os, sys
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); tables = json.load(open(sys.argv[2]))
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[3:]] or [(360, 740), (540, 900), (1440, 900)]
OUT = os.path.dirname(os.path.abspath(__file__)); URL = f'http://127.0.0.1:{PORT}/'
problems = []
def note(*a): print(' '.join(str(x) for x in a), flush=True)
def shot(p, name): p.screenshot(path=f'{OUT}/{name}.jpg', type='jpeg', quality=60); note('  shot', name)
def hscroll(p, tag):
    if p.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"): problems.append((tag, 'page scrolls sideways')); note('  HSCROLL', tag)
AUTOPLAY = """([tid, me]) => { const s = window.PingSocket; let last = ''; window.__hands = 0; s.on('showdown_result', () => { window.__hands++; });
  s.on('game_state', (gs) => { if (gs.status !== 'playing' || gs.paused) return; const i = gs.players.findIndex(p => p.name === me); if (i < 0 || gs.currentPlayerIdx !== i) return;
    const sig = gs.handNum + '|' + gs.street + '|' + gs.currentBet + '|' + gs.pot; if (sig === last) return; last = sig; const toCall = gs.currentBet - gs.players[i].roundBet;
    setTimeout(() => s.emit('player_action', { roomId: tid, action: toCall > 0 ? 'call' : 'check' }), 300); }); }"""
def clear_modals(p):
    for _ in range(3):
        if not p.locator('.pj-modal.open').count(): return
        p.keyboard.press('Escape'); p.wait_for_timeout(250)
        if p.locator('.pj-modal.open').count():
            try: p.locator('.pj-modal.open button').last.click(timeout=1500)
            except Exception: pass
            p.wait_for_timeout(300)
def leg(b, w, h):
    tag = f'{w}'; me = f'L{w}r{os.getpid() % 10000}'; t = tables['chips']
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('pageerror', lambda e: (problems.append((tag, 'pageerror ' + str(e)[:200])), note('  PAGEERROR', str(e)[:200])))
    p.on('console', lambda m: note('  [console.error]', m.text[:160]) if m.type == 'error' else None)
    p.goto(URL, wait_until='load'); p.wait_for_selector('#lb-signform', timeout=10000); p.wait_for_timeout(500)
    shot(p, f'{tag}-1-login'); hscroll(p, tag + '-login')
    # 1. login form, through the ballot buttons
    p.click('[data-tab="up"]'); p.wait_for_timeout(450)
    assert p.get_attribute('[data-tab="up"]', 'aria-selected') == 'true', 'tab did not switch'
    p.fill('#lb-name', me); p.fill('#lb-pin', '4321')
    shot(p, f'{tag}-2-newaccount'); hscroll(p, tag + '-newaccount')
    p.click('#lb-submit')
    p.wait_for_function("window.Lobby && window.Lobby.user && window.Lobby.user()", timeout=10000); p.wait_for_timeout(900); clear_modals(p)
    # 2. lobby, radio off (new account)
    np0 = p.evaluate("window.PingMusic ? window.PingMusic.nowPlaying() : null"); note('  radio at first lobby:', json.dumps(np0)[:200])
    shot(p, f'{tag}-3-lobby'); hscroll(p, tag + '-lobby')
    # 3. radio on through its own control
    bar = p.locator('#mu-bar'); assert bar.count() == 1, 'no radio control in the page'
    vis = p.evaluate("(() => { const b = document.getElementById('mu-bar'); const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top, disp: getComputedStyle(b).display }; })()"); note('  mu-bar box:', json.dumps(vis))
    def play_btn():
        if p.locator('#mu-play').is_visible(): return p.locator('#mu-play')
        if not p.locator('#mu-play2').is_visible(): p.click('#mu-now'); p.wait_for_selector('#mu-play2', state='visible', timeout=4000)
        return p.locator('#mu-play2')
    on0 = bool(np0 and np0.get('playing'))
    if on0:                                  # default came up ON: prove the control turns it off, then on again
        play_btn().click(); p.wait_for_function("!window.PingMusic.nowPlaying().playing", timeout=8000); p.wait_for_timeout(300)
        note('  radio off by its button: playing =', p.evaluate("window.PingMusic.nowPlaying().playing"))
    play_btn().click()
    p.wait_for_function("window.PingMusic.nowPlaying() && window.PingMusic.nowPlaying().playing", timeout=20000); p.wait_for_timeout(700)
    np1 = p.evaluate("window.PingMusic.nowPlaying()"); note('  radio playing:', json.dumps(np1)[:240])
    shot(p, f'{tag}-4-radio-on'); hscroll(p, tag + '-radio')
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    if p.locator('#mu-pop').is_visible(): p.click('#mu-now'); p.wait_for_timeout(300)
    note('  radio sheet closed:', not p.locator('#mu-pop').is_visible())
    # top bar still usable with the radio in the page (where the top bar is shown at all)
    tb = p.evaluate("""() => ['sh-wallet','sh-bonus','sh-acct','sh-out'].map(id => { const e = document.getElementById(id); if (!e) return [id, 'missing']; const r = e.getBoundingClientRect(); if (!r.width) return [id, 'hidden'];
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [id, (hit && (hit === e || e.contains(hit))) ? 'ok' : 'covered by ' + (hit && (hit.id || hit.className)), Math.round(r.left), Math.round(r.right)]; })""")
    note('  top bar:', json.dumps(tb))
    for row in tb:
        if str(row[1]).startswith('covered'): problems.append((tag, 'top bar ' + json.dumps(row)))
        if len(row) > 3 and row[3] > w + 1: problems.append((tag, 'top bar off screen ' + json.dumps(row)))
    # 4. a table, hands
    p.evaluate("(tid) => window.PingSocket.emit('table_join', { tableId: tid, buyIn: 3000 })", t['id'])
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=10000)
    p.evaluate(AUTOPLAY, [t['id'], me]); p.wait_for_function("window.__hands >= 4", timeout=180000); p.wait_for_timeout(600); clear_modals(p)
    note('  still playing at the table:', p.evaluate("window.PingMusic.nowPlaying().playing"))
    shot(p, f'{tag}-5-table'); hscroll(p, tag + '-table')
    # 5. recap from the table
    p.wait_for_selector('#rc-table-btn:not(.hidden)', timeout=5000); clear_modals(p); p.click('#rc-table-btn'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(500)
    d = p.evaluate("""() => new Promise(r => { const s = window.PingSocket; s.once('recap_data', r); s.emit('recap_get', { tableId: '%s' }); })""" % t['id'])
    nets = [(x['name'], x['net']) for x in d['players']]; hands = d['hands']
    note('  recap: hands', len(hands), 'players', nets, 'handNetSum', d['totals']['handNetSum'])
    for hd in hands:
        s = sum(x['net'] for x in hd['players'])
        if s != 0: problems.append((tag, f"hand {hd['handNum']} nets sum {s}"))
        for x in hd['players']:
            if x['name'] != me and any(c for c in x['cards']) and not hd['showdown']: problems.append((tag, f"hand {hd['handNum']} shows {x['name']} cards without a showdown"))
    shot(p, f'{tag}-6-recap'); hscroll(p, tag + '-recap')
    p.locator('.rc-hand').first.click(); p.wait_for_timeout(200)
    for _ in range(5):
        if p.locator('#rc-next').is_disabled(): break
        p.click('#rc-next'); p.wait_for_timeout(100)
    p.locator('#rc-replay').scroll_into_view_if_needed(); p.wait_for_timeout(250); shot(p, f'{tag}-7-replay')
    p.keyboard.press('Escape'); p.wait_for_timeout(300)
    # 6. leave, night-end screen, recap from there; nets must match settle_up
    p.evaluate("(tid) => window.PingSocket.emit('table_leave', { tableId: tid })", t['id']); p.wait_for_timeout(1500)
    su = p.evaluate("""(nid) => new Promise(r => { const s = window.PingSocket; s.once('settle_up', r); s.emit('night_get', { nightId: nid }); })""", t['nightId'])
    p.wait_for_selector('.lb-settle #lb-recap', timeout=10000); p.wait_for_timeout(400); shot(p, f'{tag}-8-night-end'); hscroll(p, tag + '-night-end')
    d2 = p.evaluate("""(nid) => new Promise(r => { const s = window.PingSocket; s.once('recap_data', r); s.emit('recap_get', { nightId: nid }); })""", t['nightId'])
    a = {x['key']: x['net'] for x in su['players']}; bnet = {x['key']: x['net'] for x in d2['players']}
    note('  settle_up nets', a); note('  recap nets   ', bnet)
    if a != bnet: problems.append((tag, f'recap night nets {bnet} != settle_up {a}'))
    p.click('#lb-recap'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(400); shot(p, f'{tag}-9-recap-from-night-end')
    ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    try:
        for (w, h) in SIZES: note('==', w, h); leg(b, w, h)
    finally: b.close()
note('PROBLEMS', len(problems))
for pr in problems: note('  ', pr)
sys.exit(1 if problems else 0)
