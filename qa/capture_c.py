#!/usr/bin/env python3
"""W1b verification. Local only (PORT 3201). Usage: python3 qa/capture.py [WxH ...]"""
import os, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'qa', 'final'); os.makedirs(SHOTS, exist_ok=True)
PORT = 3217; URL = f'http://localhost:{PORT}/'
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (1920, 1080)]
LOG = open(os.path.join(ROOT, 'qa', 'capture-c.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
srv = None
def start():
    global srv
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(ROOT, 'qa', 'bank-test-c.json')}, stdout=open(os.path.join(ROOT, 'qa', 'server-shoot.log'), 'w'), stderr=subprocess.STDOUT)
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
    ctx, p = page(b, w, h)
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(500)
    for nm in ('Bob', 'Carla', 'Dan', 'Eve', 'Finn'):
        p.evaluate(HELPER, [nm, '🦊'])
    p.wait_for_timeout(600)
    t0 = time.time(); done = False
    while time.time() - t0 < 90 and not done:
        g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, street: gs?.street, ctl: !!document.querySelector('#btn-check-call') && !document.querySelector('#btn-check-call').disabled } }""")
        if g['st'] == 'playing' and g['cur'] == g['my'] and g['ctl']:
            if g['street'] in ('turn', 'river'):
                p.wait_for_timeout(1500); p.screenshot(path=f'{SHOTS}/c-{w}.png'); log('shot', w, g['street']); done = True; break
            p.click('#btn-check-call'); p.wait_for_timeout(700)
        else: p.wait_for_timeout(250)
    ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch(); start()
    try:
        for w, h in SIZES: log('==', w, h); run(b, w, h)
    finally: stop(); b.close()
