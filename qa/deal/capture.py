#!/usr/bin/env python3
"""Deal animation verification. Scratch server on PORT 3131. Usage: python3 qa/deal/capture.py [WxH ...]"""
import os, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, 'qa', 'scratch'); os.makedirs(SHOTS, exist_ok=True)
PORT = 3131; URL = f'http://localhost:{PORT}/'
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (1920, 1080)]
LOG = open(os.path.join(ROOT, 'qa', 'scratch', 'deal-capture.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
srv = None
def start():
    global srv
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(ROOT, 'qa', 'scratch', 'bank-tmp.json'), 'LEDGER_FILE': os.path.join(ROOT, 'qa', 'scratch', 'ledger-tmp.json')}, stdout=open(os.path.join(ROOT, 'qa', 'scratch', 'deal-server.log'), 'w'), stderr=subprocess.STDOUT)
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
    errs = []
    ctx, p = page(b, w, h)
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
    for nm in ('Bob', 'Carla'):
        p.evaluate(HELPER, [nm, '\U0001F98A'])
    p.wait_for_timeout(500)
    p.click('#btn-start')
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
    for k in range(5):
        p.screenshot(path=f'{SHOTS}/{w}x{h}-deal-preflop-{k}.png'); log('  shot preflop', k, p.evaluate("document.querySelectorAll('#deal-layer .card').length"), 'flyers')
        p.wait_for_timeout(90)
    p.wait_for_timeout(1200)
    log('  leftover flyers', p.evaluate("document.querySelectorAll('#deal-layer .card').length"), 'pending', p.evaluate("Object.keys(state.dealPend).length"), 'waiting', p.evaluate("document.querySelectorAll('.dealwait').length"))
    p.screenshot(path=f'{SHOTS}/{w}x{h}-deal-settled.png')
    n = 0; shot_flop = False; t0 = time.time()
    while time.time() - t0 < 60 and not shot_flop:
        g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, comm: (gs?.community||[]).length, ctl: !!document.querySelector('#btn-check-call') && !document.querySelector('#btn-check-call').disabled } }""")
        if g['comm'] >= 3:
            for k in range(3):
                p.screenshot(path=f'{SHOTS}/{w}x{h}-deal-flop-{k}.png'); p.wait_for_timeout(80)
            p.wait_for_timeout(900)
            log('  flop leftover', p.evaluate("document.querySelectorAll('#deal-layer .card').length"), 'waiting', p.evaluate("document.querySelectorAll('.dealwait').length"))
            shot_flop = True; break
        if g['ctl'] and g['st'] == 'playing' and g['cur'] == g['my']:
            p.click('#btn-check-call'); p.wait_for_timeout(500)
        else: p.wait_for_timeout(150)
    log('  flop shot', shot_flop, 'errors', errs); ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    try:
        for w, h in SIZES:
            for f in ('bank-tmp.json', 'ledger-tmp.json'):
                try: os.remove(os.path.join(ROOT, 'qa', 'scratch', f))
                except OSError: pass
            start(); log('==', w, h)
            try: run(b, w, h)
            finally: stop()
    finally: b.close()
