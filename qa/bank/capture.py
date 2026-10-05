#!/usr/bin/env python3
"""Bank dashboard QA. Local only: PORT 3921, temp BANK_FILE/LEDGER_FILE. Usage: python3 qa/bank/capture.py [WxH ...]"""
import os, shutil, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, 'qa', 'bank'); os.makedirs(SHOTS, exist_ok=True)
PORT = 3921; URL = f'http://localhost:{PORT}/'
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (1920, 1080)]
HANDS = int(os.environ.get('HANDS', '10'))
LOG = open(os.path.join(SHOTS, 'capture.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
srv = None
def start(tag):
    global srv
    bf = os.path.join(SHOTS, f'bank-tmp-{tag}.json'); lf = os.path.join(SHOTS, f'ledger-tmp-{tag}.json')
    for f in (bf, lf):
        if os.path.exists(f): os.remove(f)
    import json
    open(bf, 'w').write(json.dumps({'marco': 6200, 'dee': 13400}))
    d = 86400000; n = int(time.time() * 1000)
    ev = lambda t, nm, ty, a, bal: {'t': n - t, 'name': nm, 'type': ty, 'amount': a, 'balanceAfter': bal, 'tableChips': None, 'handNum': 3, 'room': 'OLD'}
    open(lf, 'w').write(json.dumps([ev(2*d, 'marco', 'buyin', 1500, 8500), ev(2*d-3600000, 'marco', 'rebuy', 1500, 7000), ev(2*d-7200000, 'marco', 'rebuy', 1500, 5500), ev(2*d-9000000, 'marco', 'cashout', 2200, 7700),
      ev(d, 'dee', 'buyin', 1500, 8500), ev(d-1800000, 'dee', 'cashout', 4900, 13400), ev(d-5000, 'marco', 'cashout', 1500, 6200)]))
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': bf, 'LEDGER_FILE': lf}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try: urllib.request.urlopen(URL, timeout=1); return
        except Exception: time.sleep(0.25)
    raise RuntimeError('no server')
def stop():
    global srv
    if srv: srv.send_signal(signal.SIGTERM); srv.wait(5); srv = None
# style: 'bob' = raiser, 'carla' = all-in gambler, 'me' = caller
POLICY = """(style, s, getMy) => {
  let last = '';
  s.on('bust_out', () => setTimeout(() => s.emit('rebuy', { roomId: 'POKERPING' }), 600));
  s.on('game_state', gs => {
    const my = getMy();
    if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
    const key = gs.handNum + gs.street + gs.pot + gs.currentBet; if (key === last) return; last = key;
    const me = gs.players[my], toCall = gs.currentBet - me.roundBet, r = Math.random();
    let action = toCall > 0 ? 'call' : 'check', amount;
    const big = toCall > me.chips * 0.35;
    if (big && r < 0.65) action = 'fold';
    else if (style === 'bob' && r < 0.3) { action = 'raise'; amount = gs.currentBet + 140; }
    else if (style === 'carla' && r < 0.12) { action = 'raise'; amount = 99999; }
    else if (style === 'me' && r < 0.15) { action = 'raise'; amount = gs.currentBet + 100; }
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action, amount }), 200);
  });
}"""
HELPER = """([name, avatar, style, policy]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null;
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  eval('(' + policy + ')')(style, s, () => my);
  s.on('connect', () => s.emit('join_game', { name, avatar, password: 'ping' }));
  (window.__socks = window.__socks || {})[name] = s;
})"""
def run(b, w, h):
    start(f'{w}x{h}')
    sh = lambda p, n: (p.screenshot(path=f'{SHOTS}/{w}x{h}-{n}.png'), log('  shot', n))
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('console', lambda m: log('  [console]', m.type, m.text[:140]) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: log('  [pageerror]', str(e)[:200]))
    p.goto(URL, wait_until='load'); p.wait_for_timeout(700)
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
    p.evaluate("""([policy]) => { const my = () => state.myIdx; eval('(' + policy + ')')('me', state.socket, my); }""", [POLICY])
    for nm, av, st in (('Bob', '🦊', 'bob'), ('Carla', '🎲', 'carla')):
        p.evaluate(HELPER, [nm, av, st, POLICY])
    p.wait_for_timeout(500)
    p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
    p.wait_for_timeout(1200)
    p.click('#bank-btn'); p.wait_for_timeout(900); sh(p, 'bank-empty'); p.click('#bank-close'); p.wait_for_timeout(400)
    t0 = time.time(); sat = False
    while time.time() - t0 < 240:
        hn = p.evaluate("state.gameState?.handNum || 0")
        if hn >= HANDS // 2 and not sat:
            p.evaluate("window.__socks.Bob.emit('sit_out', { roomId: 'POKERPING' })"); sat = True
        if hn >= HANDS: break
        p.wait_for_timeout(1000)
    log('  hands reached', p.evaluate("state.gameState?.handNum"))
    p.wait_for_timeout(6500)
    p.evaluate("window.__socks.Carla.close()"); p.wait_for_timeout(1500)
    p.click('#bank-btn'); p.wait_for_timeout(1500); sh(p, 'bank-full')
    p.mouse.move(int((w - 300 * min(1.35, max(0.8, min(h / 900, w / 1440)))) * 0.62), int(h * 0.30)); p.wait_for_timeout(400); sh(p, 'bank-hover')
    ctx.close(); stop()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    try:
        for w, h in SIZES: log('==', w, h); run(b, w, h)
    finally: stop(); b.close()
