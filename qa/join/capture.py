#!/usr/bin/env python3
"""Join-straight-to-table check. Local only (PORT 3912, temp bank/ledger)."""
import os, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'qa', 'join'); PORT = 3912; URL = f'http://localhost:{PORT}/'
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (1920, 1080)]
LOG = open(os.path.join(D, 'capture.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
for f in ('bank-tmp.json', 'ledger-tmp.jsonl'):
    try: os.remove(os.path.join(D, f))
    except FileNotFoundError: pass
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(D, 'bank-tmp.json'), 'LEDGER_FILE': os.path.join(D, 'ledger-tmp.jsonl')}, stdout=open(os.path.join(D, 'server.log'), 'w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
HELPER = """([name, avatar]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null, last = '';
  s.on('error', e => res({ error: e.message }));
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => {
    const i = gs.players.findIndex(p => p.name === name); if (i >= 0) my = i;
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
    p.goto(URL, wait_until='load'); p.wait_for_timeout(600); return ctx, p
def active(p): return p.evaluate("[...document.querySelectorAll('.screen.active')].map(e => e.id)")
def join(p, name):
    p.fill('#player-name', name); p.fill('#password-input', 'ping'); p.wait_for_timeout(250)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(900)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h in SIZES:
            log('==', w, h)
            sh = lambda p, n: (p.screenshot(path=f'{D}/{w}x{h}-{n}.png'), log('  shot', n))
            ctx, p = page(b, w, h); join(p, f'Isa{w}')
            log('  screens after join:', active(p)); sh(p, '1-alone')
            ctx2, p2 = page(b, w, h)
            for nm in ('Bob', 'Carla'): log('  helper', nm, p.evaluate(HELPER, [nm, '🦊']))
            p.wait_for_timeout(700); sh(p, '2-host-3p')
            log('  start disabled?', p.evaluate("document.getElementById('btn-start').disabled"))
            p.click('#btn-start'); p.wait_for_timeout(2500); sh(p, '3-playing')
            join(p2, f'Late{w}'); sh(p2, '4-late-joiner')
            log('  late screens:', active(p2), 'bar:', p2.inner_text('#bar-status-main'), '|', p2.inner_text('#bar-status-sub'))
            log('  server status:', p.evaluate("state.gameState.status"), 'players', p.evaluate("state.gameState.players.length"))
            # wait until the late joiner is dealt in
            ok = False
            for _ in range(240):
                if p2.evaluate("(()=>{const m=state.gameState?.players[state.myIdx];return !!m&&m.cardCount>0})()"): ok = True; break
                p2.wait_for_timeout(500)
            log('  late joiner dealt in:', ok); sh(p2, '5-late-dealt')
            ctx.close(); ctx2.close()
            p3 = None
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(5)
