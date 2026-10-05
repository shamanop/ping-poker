#!/usr/bin/env python3
"""W1b verification. Local only (PORT 3201). Usage: python3 qa/capture.py [WxH ...]"""
import os, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, 'qa', 'final'); os.makedirs(SHOTS, exist_ok=True)
PORT = 3911; URL = f'http://localhost:{PORT}/'
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (1920, 1080)]
LOG = open(os.path.join(ROOT, 'qa', 'final', 'capture.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
srv = None
def start():
    global srv
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(ROOT, 'qa', 'final', 'bank-tmp.json')}, stdout=open(os.path.join(ROOT, 'qa', 'final', 'server.log'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(40):
        try: urllib.request.urlopen(URL, timeout=1); return
        except Exception: time.sleep(0.25)
    raise RuntimeError('no server')
def stop():
    if srv: srv.send_signal(signal.SIGTERM); srv.wait(5)
HELPER = """([name, avatar]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null, last = '';
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => {
    if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
    const key = gs.handNum + gs.street + gs.pot + gs.currentBet; if (key === last) return; last = key;
    const toCall = gs.currentBet - gs.players[my].roundBet;
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? 'call' : 'check' }), 400);
  });
  s.on('connect', () => s.emit('join_game', { name, avatar, password: 'ping' }));
  (window.__socks = window.__socks || []).push(s);
})"""
def page(b, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('console', lambda m: log('  [console]', m.type, m.text[:140]) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: log('  [pageerror]', str(e)[:200]))
    p.on('requestfailed', lambda r: log('  [reqfail]', r.url[-60:]))
    p.on('response', lambda r: log('  [http]', r.status, r.url[-60:]) if r.status >= 400 else None)
    p.goto(URL, wait_until='load'); p.wait_for_timeout(700); return ctx, p
def run(b, w, h):
    sh = lambda p, n: (p.screenshot(path=f'{SHOTS}/{w}x{h}-{n}.png'), log('  shot', n))
    ctx, p = page(b, w, h); sh(p, '1-landing')
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(500)
    sh(p, '2-lobby')
    for nm in ('Bob', 'Carla'):
        p.evaluate(HELPER, [nm, '🦊'])
    p.wait_for_timeout(500)
    sh(p, '2b-lobby-3p')
    p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
    p.wait_for_timeout(1500); sh(p, '3-table-dealt')
    seen = set(); t0 = time.time(); did_raise = False
    while time.time() - t0 < 120:
        g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, street: gs?.street, sd: !document.getElementById('showdown-overlay').classList.contains('hidden'), ctl: !document.getElementById('btn-check-call').disabled, hand: gs?.handNum } }""")
        if g['sd'] and 'sd' not in seen:
            p.wait_for_timeout(900); sh(p, '5-showdown'); seen.add('sd'); break
        if g['ctl'] and g['st'] == 'playing' and g['cur'] == g['my']:
            key = g['street']
            if key not in seen: p.wait_for_timeout(500); sh(p, f'4-myturn-{key}'); seen.add(key)
            if not did_raise and g['street'] == 'flop':
                p.click('#raise-presets .pre:nth-child(3)'); p.wait_for_timeout(200); sh(p, '4b-raise-preset'); p.click('#btn-raise'); did_raise = True
            else: p.click('#btn-check-call')
            p.wait_for_timeout(700)
        else: p.wait_for_timeout(250)
    log('  seen', sorted(seen), 'raise', did_raise); ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch(); start()
    try:
        for w, h in SIZES: log('==', w, h); run(b, w, h)
    finally: stop(); b.close()
